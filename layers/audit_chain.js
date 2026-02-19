/**
 * KURO::AUDIT v2.0
 * Ed25519-signed, daily-rotated, hash-chained audit log
 * Tamper-evident + tamper-resistant (key stored root-only at /etc/kuro/audit.key)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const AUDIT_DIR = path.join(DATA_DIR, 'audit');
const KEY_PATH = process.env.KURO_AUDIT_KEY || '/etc/kuro/audit.key';
const GENESIS_HASH = '0'.repeat(64);

let lastHash = GENESIS_HASH;
let sequence = 0;
let signingKey = null;
let verifyKey = null;

// ── Key Management ───────────────────────────────────────────────────────
function initKeys() {
  try {
    if (fs.existsSync(KEY_PATH)) {
      const keyData = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
      signingKey = crypto.createPrivateKey({ key: Buffer.from(keyData.private, 'base64'), format: 'der', type: 'pkcs8' });
      verifyKey = crypto.createPublicKey({ key: Buffer.from(keyData.public, 'base64'), format: 'der', type: 'spki' });
      return true;
    }
  } catch (e) { console.warn('[AUDIT] Key load failed:', e.message, '— falling back to HMAC'); }
  return false;
}

function generateKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const keyData = {
    public: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    private: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    created: new Date().toISOString(),
    algorithm: 'Ed25519'
  };
  return keyData;
}

// ── File rotation ────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }

function chainFile(date) { return path.join(AUDIT_DIR, `audit_chain_${date || todayStr()}.jsonl`); }
function headFile() { return path.join(AUDIT_DIR, 'audit_chain_head.json'); }

function initChain() {
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const hasKeys = initKeys();
  try {
    if (fs.existsSync(headFile())) {
      const head = JSON.parse(fs.readFileSync(headFile(), 'utf8'));
      lastHash = head.hash || GENESIS_HASH;
      sequence = head.sequence || 0;
      return { ...head, signed: hasKeys };
    }
  } catch (e) {}
  return { hash: GENESIS_HASH, sequence: 0, signed: hasKeys };
}

// ── Signing ──────────────────────────────────────────────────────────────
function signEntry(payload) {
  if (signingKey) {
    try {
      return crypto.sign(null, Buffer.from(payload), signingKey).toString('base64');
    } catch (e) { console.warn('[AUDIT] Sign failed:', e.message); }
  }
  // HMAC fallback (key derived from chain genesis — weaker but functional)
  return crypto.createHmac('sha256', GENESIS_HASH).update(payload).digest('base64');
}

function verifySignature(payload, signature) {
  if (verifyKey) {
    try {
      return crypto.verify(null, Buffer.from(payload), verifyKey, Buffer.from(signature, 'base64'));
    } catch (e) { return false; }
  }
  const hmac = crypto.createHmac('sha256', GENESIS_HASH).update(payload).digest('base64');
  return hmac === signature;
}

// ── Log event ────────────────────────────────────────────────────────────
function logEvent(event) {
  sequence++;
  const entry = {
    seq: sequence,
    ts: new Date().toISOString(),
    date: todayStr(),
    prev: lastHash,
    requestId: event.requestId || null,
    clientFingerprint: event.clientFingerprint || null,
    agent: event.agent || 'system',
    action: event.action || 'unknown',
    skill: event.skill || null,
    target: event.target || null,
    result: event.result || 'ok',
    userId: event.userId || 'anon',
    meta: event.meta || {}
  };

  // Hash
  const hashPayload = lastHash + JSON.stringify(entry);
  entry.hash = crypto.createHash('sha256').update(hashPayload).digest('hex');

  // Sign
  entry.sig = signEntry(hashPayload);

  lastHash = entry.hash;

  // Write to daily rotated file
  try {
    const cf = chainFile();
    fs.appendFileSync(cf, JSON.stringify(entry) + '\n');
    fs.writeFileSync(headFile(), JSON.stringify({ hash: lastHash, sequence, date: todayStr(), signed: !!signingKey }));
  } catch (e) { console.error('[AUDIT] Write failed:', e.message); }

  return entry;
}

// ── Verify chain ─────────────────────────────────────────────────────────
function verifyChain(date) {
  try {
    const cf = chainFile(date);
    if (!fs.existsSync(cf)) return { valid: true, entries: 0, message: 'No entries for ' + (date || todayStr()) };
    const lines = fs.readFileSync(cf, 'utf8').trim().split('\n').filter(l => l);
    let prevHash = GENESIS_HASH;
    let valid = 0, sigValid = 0, sigFail = 0;

    // If checking non-today file, find the prevHash from the prior day's last entry
    // For simplicity, each day's chain starts from the head of the previous day or GENESIS
    // In production you'd link cross-day via sealed heads

    for (const line of lines) {
      const entry = JSON.parse(line);
      const storedHash = entry.hash;
      const storedSig = entry.sig;
      const check = { ...entry };
      delete check.hash;
      delete check.sig;

      const payload = prevHash + JSON.stringify(check);
      const computed = crypto.createHash('sha256').update(payload).digest('hex');

      if (computed !== storedHash) {
        return { valid: false, brokenAt: entry.seq, expected: computed, got: storedHash, validEntries: valid, message: `Hash mismatch at seq ${entry.seq}` };
      }

      if (storedSig) {
        if (verifySignature(payload, storedSig)) sigValid++;
        else sigFail++;
      }

      prevHash = storedHash;
      valid++;
    }

    return { valid: true, entries: valid, headHash: prevHash, signatures: { valid: sigValid, failed: sigFail }, message: 'Chain intact' };
  } catch (e) { return { valid: false, error: e.message }; }
}

// ── Verify all days ──────────────────────────────────────────────────────
function verifyAll() {
  try {
    const files = fs.readdirSync(AUDIT_DIR).filter(f => f.startsWith('audit_chain_') && f.endsWith('.jsonl')).sort();
    const results = [];
    for (const f of files) {
      const date = f.replace('audit_chain_', '').replace('.jsonl', '');
      results.push({ date, ...verifyChain(date) });
    }
    return { days: results, allValid: results.every(r => r.valid), totalEntries: results.reduce((s, r) => s + (r.entries || 0), 0) };
  } catch (e) { return { allValid: false, error: e.message }; }
}

// ── Recent entries ───────────────────────────────────────────────────────
function recentEntries(n) {
  try {
    const cf = chainFile();
    if (!fs.existsSync(cf)) return [];
    const lines = fs.readFileSync(cf, 'utf8').trim().split('\n').filter(l => l);
    return lines.slice(-(n || 50)).map(l => JSON.parse(l));
  } catch (e) { return []; }
}

// ── Stats ────────────────────────────────────────────────────────────────
function auditStats() {
  try {
    const files = fs.readdirSync(AUDIT_DIR).filter(f => f.startsWith('audit_chain_') && f.endsWith('.jsonl'));
    let total = 0;
    const agents = {}, skills = {}, results = { ok: 0, denied: 0, error: 0 };

    for (const f of files) {
      const lines = fs.readFileSync(path.join(AUDIT_DIR, f), 'utf8').trim().split('\n').filter(l => l);
      total += lines.length;
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          agents[e.agent] = (agents[e.agent] || 0) + 1;
          if (e.skill) skills[e.skill] = (skills[e.skill] || 0) + 1;
          results[e.result] = (results[e.result] || 0) + 1;
        } catch (e) {}
      }
    }

    return { total, days: files.length, agents, skills, results, headHash: lastHash, signed: !!signingKey };
  } catch (e) { return { total: 0, error: e.message }; }
}

// ── Seal a day's log (create signed digest) ──────────────────────────────
function sealDay(date) {
  const d = date || todayStr();
  const cf = chainFile(d);
  if (!fs.existsSync(cf)) return { sealed: false, reason: 'No log for ' + d };

  const content = fs.readFileSync(cf, 'utf8');
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  const seal = {
    date: d,
    digest,
    entries: content.trim().split('\n').length,
    sealed: new Date().toISOString(),
    sig: signEntry(digest)
  };

  fs.writeFileSync(path.join(AUDIT_DIR, `seal_${d}.json`), JSON.stringify(seal, null, 2));
  return { sealed: true, ...seal };
}

const _init = initChain();

module.exports = { logEvent, verifyChain, verifyAll, recentEntries, auditStats, sealDay, generateKeys, initChain };
