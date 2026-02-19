const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config.js');

const CACHE_PATH = config.shadow?.mnemosyne?.storagePath || '/var/www/kuro/data/shadow/cache/';
if (!fs.existsSync(CACHE_PATH)) fs.mkdirSync(CACHE_PATH, { recursive: true });

const MnemosyneCache = {
  name: 'Mnemosyne Cache', layer: 11.5, color: '#f472b6',
  
  deniableStorage: {
    async store(data, visiblePassword, hiddenPassword) {
      if (!config.features?.deniableEncryption) throw new Error('Deniable encryption disabled');
      const containerId = crypto.randomBytes(16).toString('hex');
      const visibleData = { type: 'session', userId: crypto.randomBytes(8).toString('hex'), preferences: { theme: 'dark' } };
      const visibleEncrypted = this.encrypt(JSON.stringify(visibleData), visiblePassword);
      const hiddenEncrypted = this.encrypt(JSON.stringify(data), hiddenPassword);
      const container = this.interleaveData(visibleEncrypted, hiddenEncrypted);
      fs.writeFileSync(path.join(CACHE_PATH, `${containerId}.mnem`), JSON.stringify({ id: containerId, version: 1, created: Date.now(), container, integrity: crypto.createHash('sha256').update(container).digest('hex') }));
      return { id: containerId, size: container.length };
    },
    
    async retrieve(containerId, password) {
      if (!config.features?.deniableEncryption) throw new Error('Deniable encryption disabled');
      const containerPath = path.join(CACHE_PATH, `${containerId}.mnem`);
      if (!fs.existsSync(containerPath)) return null;
      const containerData = JSON.parse(fs.readFileSync(containerPath, 'utf8'));
      const { visible, hidden } = this.extractData(containerData.container);
      try { return { type: 'visible', data: JSON.parse(this.decrypt(visible, password)) }; } catch (e) {}
      try { return { type: 'hidden', data: JSON.parse(this.decrypt(hidden, password)) }; } catch (e) {}
      return null;
    },
    
    encrypt(data, password) {
      const salt = crypto.randomBytes(16), key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256'), iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let enc = cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
      return salt.toString('hex') + ':' + iv.toString('hex') + ':' + cipher.getAuthTag().toString('hex') + ':' + enc;
    },
    
    decrypt(data, password) {
      const [saltHex, ivHex, authTagHex, enc] = data.split(':');
      const key = crypto.pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), 100000, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
    },
    
    interleaveData(visible, hidden) {
      const vLen = Buffer.alloc(4), hLen = Buffer.alloc(4);
      vLen.writeUInt32BE(visible.length); hLen.writeUInt32BE(hidden.length);
      let result = vLen.toString('hex') + hLen.toString('hex');
      const max = Math.max(visible.length, hidden.length);
      for (let i = 0; i < max; i++) { result += (visible[i] || crypto.randomBytes(1).toString('hex')[0]) + (hidden[i] || crypto.randomBytes(1).toString('hex')[0]) + crypto.randomBytes(1).toString('hex')[0]; }
      return result;
    },
    
    extractData(container) {
      const vLen = Buffer.from(container.slice(0, 8), 'hex').readUInt32BE();
      const hLen = Buffer.from(container.slice(8, 16), 'hex').readUInt32BE();
      let visible = '', hidden = '';
      for (let i = 0, d = container.slice(16); i < d.length; i += 3) { if (visible.length < vLen) visible += d[i] || ''; if (hidden.length < hLen) hidden += d[i + 1] || ''; }
      return { visible, hidden };
    },
  },
  
  cleanup(maxAgeMs = 604800000) {
    let cleaned = 0;
    for (const file of fs.readdirSync(CACHE_PATH).filter(f => f.endsWith('.mnem'))) {
      try { const c = JSON.parse(fs.readFileSync(path.join(CACHE_PATH, file), 'utf8')); if (Date.now() - c.created > maxAgeMs) { fs.writeFileSync(path.join(CACHE_PATH, file), crypto.randomBytes(fs.statSync(path.join(CACHE_PATH, file)).size)); fs.unlinkSync(path.join(CACHE_PATH, file)); cleaned++; } } catch (e) { fs.unlinkSync(path.join(CACHE_PATH, file)); cleaned++; }
    }
    return cleaned;
  },
  
  getStats() {
    let count = 0, size = 0;
    try { for (const f of fs.readdirSync(CACHE_PATH).filter(f => f.endsWith('.mnem'))) { count++; size += fs.statSync(path.join(CACHE_PATH, f)).size; } } catch (e) {}
    return { layer: this.layer, name: this.name, enabled: config.features?.mnemosyneCache, stats: { containers: count, totalSizeBytes: size } };
  },
};

module.exports = MnemosyneCache;
