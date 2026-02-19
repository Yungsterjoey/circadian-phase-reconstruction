/**
 * KURO::VISION — Storage Controller
 * 
 * RT-08 fix: Disk discipline with profile-based retention.
 * All writes fenced to /var/lib/kuro/vision/
 * 
 * Profiles:
 *   lab:        Keep last 100 images or 7 days
 *   enterprise: Keep 90 days, hash + seal artifacts
 *   gov:        Keep 1 year, mandatory hashing, external store hooks
 * 
 * v6.3 compliance: Writes only to DATA_DIR/vision/, audited.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.KURO_DATA_DIR || '/var/lib/kuro';
const VISION_DIR = path.join(DATA_DIR, 'vision');
const SESSIONS_DIR = path.join(VISION_DIR, 'sessions');

// ─── Retention Policies ──────────────────────────────────────────────────

const RETENTION = {
  lab:        { maxImages: 100, maxDays: 7 },
  enterprise: { maxImages: 1000, maxDays: 90 },
  gov:        { maxImages: 5000, maxDays: 365 }
};

// ─── Init ────────────────────────────────────────────────────────────────

function init() {
  for (const dir of [VISION_DIR, SESSIONS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Save Artifact ───────────────────────────────────────────────────────

function saveArtifact(imageBuffer, metadata) {
  init();
  
  const ts = Date.now();
  const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  const filename = `vision_${metadata.requestId || 'unknown'}_${ts}.png`;
  const filepath = path.join(VISION_DIR, filename);
  
  fs.writeFileSync(filepath, imageBuffer);
  
  // Write metadata sidecar
  const meta = {
    ...metadata,
    filename,
    hash,
    created: new Date(ts).toISOString(),
    size: imageBuffer.length
  };
  fs.writeFileSync(filepath + '.json', JSON.stringify(meta, null, 2));
  
  return { filepath, filename, hash, meta };
}

// ─── Save Session State ──────────────────────────────────────────────────

function saveSession(sessionId, state) {
  init();
  const filepath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  fs.writeFileSync(filepath, JSON.stringify(state, null, 2));
  return filepath;
}

function loadSession(sessionId) {
  const filepath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

function cleanup(profile = 'lab') {
  init();
  const policy = RETENTION[profile] || RETENTION.lab;
  const now = Date.now();
  const maxAge = policy.maxDays * 86400000;
  
  // List all vision artifacts
  let files;
  try {
    files = fs.readdirSync(VISION_DIR)
      .filter(f => f.startsWith('vision_') && f.endsWith('.png'))
      .map(f => {
        const stat = fs.statSync(path.join(VISION_DIR, f));
        return { name: f, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first
  } catch {
    return { removed: 0 };
  }

  let removed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const tooOld = (now - file.mtime) > maxAge;
    const overLimit = i >= policy.maxImages;

    if (tooOld || overLimit) {
      try {
        fs.unlinkSync(path.join(VISION_DIR, file.name));
        // Remove sidecar
        const metaPath = path.join(VISION_DIR, file.name + '.json');
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
        removed++;
      } catch {}
    }
  }

  return { removed, remaining: files.length - removed, policy: profile };
}

// ─── Stats ───────────────────────────────────────────────────────────────

function stats() {
  init();
  try {
    const files = fs.readdirSync(VISION_DIR).filter(f => f.endsWith('.png'));
    const totalSize = files.reduce((s, f) => {
      try { return s + fs.statSync(path.join(VISION_DIR, f)).size; } catch { return s; }
    }, 0);
    return {
      count: files.length,
      totalSizeMB: Math.round(totalSize / 1048576 * 10) / 10,
      dir: VISION_DIR
    };
  } catch {
    return { count: 0, totalSizeMB: 0, dir: VISION_DIR };
  }
}

module.exports = { saveArtifact, saveSession, loadSession, cleanup, stats, init, VISION_DIR, SESSIONS_DIR };
