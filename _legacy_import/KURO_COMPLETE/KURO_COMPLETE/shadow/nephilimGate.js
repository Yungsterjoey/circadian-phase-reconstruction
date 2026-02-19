const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config.js');

const DROPS_PATH = config.shadow?.deadDrop?.storagePath || '/var/www/kuro/data/shadow/drops/';
if (!fs.existsSync(DROPS_PATH)) fs.mkdirSync(DROPS_PATH, { recursive: true });

const FIBONACCI = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];

const NephilimGate = {
  name: 'Nephilim Gate', layer: 0.25, color: '#dc2626',
  
  async check(req, context = {}) {
    if (!config.features?.nephilimGate) return { status: 'BYPASSED' };
    const startTime = Date.now();
    const results = { status: 'CLEAR', shadowDetected: false, patterns: [], metrics: {} };
    
    if (context.requestSequence?.length > 2) {
      const timingAnalysis = this.shadowPatternDetection.timingFingerprint(context.requestSequence);
      results.patterns.push({ type: 'timing', ...timingAnalysis });
      if (timingAnalysis.isFibonacci || timingAnalysis.isPrimeEncoded) results.shadowDetected = true;
    }
    
    if (req.body) {
      const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const entropyAnalysis = this.shadowPatternDetection.payloadEntropy(payload);
      results.patterns.push({ type: 'entropy', ...entropyAnalysis });
      if (entropyAnalysis.entropy > 7.5) results.shadowDetected = true;
    }
    
    results.metrics = { latency: Date.now() - startTime };
    if (results.shadowDetected && config.shadow?.nephilim?.logShadowTraffic) this.logShadowTraffic(req, results);
    return results;
  },
  
  shadowPatternDetection: {
    timingFingerprint(requestSequence) {
      if (!requestSequence || requestSequence.length < 3) return { isFibonacci: false, isPrimeEncoded: false };
      const intervals = requestSequence.map((r, i) => i > 0 ? r.timestamp - requestSequence[i-1].timestamp : 0).slice(1);
      const minInterval = Math.min(...intervals.filter(i => i > 0)) || 1;
      const normalized = intervals.map(i => Math.round(i / minInterval));
      const isFibonacci = normalized.filter(n => FIBONACCI.includes(n)).length / normalized.length > 0.7;
      const isPrimeEncoded = normalized.filter(n => PRIMES.includes(n)).length / normalized.length > 0.6;
      return { isFibonacci, isPrimeEncoded, intervals: normalized };
    },
    payloadEntropy(payload) {
      if (!payload) return { entropy: 0 };
      const freq = {};
      for (const char of payload) freq[char] = (freq[char] || 0) + 1;
      let entropy = 0;
      for (const char in freq) { const p = freq[char] / payload.length; entropy -= p * Math.log2(p); }
      return { entropy: Math.round(entropy * 100) / 100 };
    },
  },
  
  shadowRouting: {
    createOnionPacket(payload, route, serverKeys) {
      if (!config.features?.onionRouting) throw new Error('Onion routing disabled');
      let packet = payload;
      for (let i = route.length - 1; i >= 0; i--) {
        packet = { nextHop: route[i].address, encryptedPayload: this.encrypt(JSON.stringify(packet), route[i].publicKey), timestamp: Date.now() };
      }
      return packet;
    },
    forwardPacket(onionPacket, privateKey) {
      if (!config.features?.onionRouting) throw new Error('Onion routing disabled');
      try {
        const decrypted = JSON.parse(this.decrypt(onionPacket.encryptedPayload, privateKey));
        return { forward: decrypted.nextHop, packet: decrypted.encryptedPayload ? decrypted : null, isDestination: !decrypted.nextHop, payload: decrypted.nextHop ? null : decrypted };
      } catch (err) { return { error: 'Decryption failed' }; }
    },
    encrypt(data, key) {
      const iv = crypto.randomBytes(16);
      const keyBuffer = crypto.createHash('sha256').update(key).digest();
      const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
      let encrypted = cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
      return iv.toString('hex') + ':' + cipher.getAuthTag().toString('hex') + ':' + encrypted;
    },
    decrypt(data, key) {
      const [ivHex, authTagHex, encrypted] = data.split(':');
      const keyBuffer = crypto.createHash('sha256').update(key).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
    },
  },
  
  stegChannels: {
    encodeDNS(data) { if (!config.features?.stegChannels) return null; return Buffer.from(data).toString('base64').replace(/=/g, '').match(/.{1,63}/g).join('.') + '.kuroglass.net'; },
    decodeDNS(fqdn) { if (!config.features?.stegChannels) return null; return Buffer.from(fqdn.split('.').slice(0, -2).join(''), 'base64').toString('utf8'); },
    encodeNTP(data) { if (!config.features?.stegChannels) return null; return Date.now() * 1000000 + parseInt(Buffer.from(data).toString('hex').slice(0, 6), 16); },
  },
  
  deadDrop: {
    deposit(message, retrievalToken, expiryHours = 72) {
      if (!config.features?.deadDrops) throw new Error('Dead drops disabled');
      const drop = { id: crypto.randomBytes(16).toString('hex'), encryptedMessage: message, token: crypto.createHash('sha256').update(retrievalToken).digest('hex'), deposited: Date.now(), expires: Date.now() + (Math.min(expiryHours, 168) * 3600000), retrieved: false };
      fs.writeFileSync(path.join(DROPS_PATH, `${drop.id}.json`), JSON.stringify(drop));
      if (config.features?.chaffGeneration) this.generateChaff(20);
      return drop.id;
    },
    retrieve(dropId, retrievalToken) {
      if (!config.features?.deadDrops) throw new Error('Dead drops disabled');
      const dropPath = path.join(DROPS_PATH, `${dropId}.json`);
      if (!fs.existsSync(dropPath)) return null;
      const drop = JSON.parse(fs.readFileSync(dropPath, 'utf8'));
      if (drop.retrieved || Date.now() > drop.expires) { fs.unlinkSync(dropPath); return null; }
      if (crypto.createHash('sha256').update(retrievalToken).digest('hex') !== drop.token) return null;
      fs.unlinkSync(dropPath);
      return drop.encryptedMessage;
    },
    generateChaff(count = 10) {
      if (!config.features?.chaffGeneration) return;
      for (let i = 0; i < count; i++) {
        const fake = { id: crypto.randomBytes(16).toString('hex'), encryptedMessage: crypto.randomBytes(1024).toString('hex'), token: crypto.randomBytes(32).toString('hex'), deposited: Date.now() - Math.random() * 86400000, expires: Date.now() + Math.random() * 172800000, isChaff: true };
        fs.writeFileSync(path.join(DROPS_PATH, `${fake.id}.json`), JSON.stringify(fake));
      }
    },
    cleanup() {
      let cleaned = 0;
      for (const file of fs.readdirSync(DROPS_PATH).filter(f => f.endsWith('.json'))) {
        try { const drop = JSON.parse(fs.readFileSync(path.join(DROPS_PATH, file), 'utf8')); if (Date.now() > drop.expires) { fs.unlinkSync(path.join(DROPS_PATH, file)); cleaned++; } } catch (e) { fs.unlinkSync(path.join(DROPS_PATH, file)); cleaned++; }
      }
      return cleaned;
    },
  },
  
  trafficNormalization: {
    addJitter(delay) { if (!config.features?.trafficNormalization) return delay; return delay + Math.floor(Math.random() * 200) - 100; },
    padPacket(payload) { if (!config.features?.trafficNormalization) return payload; const target = 1500, current = JSON.stringify(payload).length; if (current >= target) return payload; return { ...payload, _padding: crypto.randomBytes(Math.floor((target - current) / 2)).toString('hex') }; },
  },
  
  logShadowTraffic(req, results) {
    const logPath = config.security?.shadowLog || '/var/www/kuro/data/shadow/shadow.log';
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), ip: req.ip, path: req.path, patterns: results.patterns }) + '\n');
  },
  
  getStats() {
    let dropCount = 0, chaffCount = 0;
    try { for (const f of fs.readdirSync(DROPS_PATH).filter(f => f.endsWith('.json'))) { const d = JSON.parse(fs.readFileSync(path.join(DROPS_PATH, f), 'utf8')); if (d.isChaff) chaffCount++; else dropCount++; } } catch (e) {}
    return { layer: this.layer, name: this.name, enabled: config.features?.nephilimGate, stats: { activeDrops: dropCount, chaffDrops: chaffCount } };
  },
};

module.exports = NephilimGate;
