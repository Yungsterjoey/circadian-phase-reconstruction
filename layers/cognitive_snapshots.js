/**
 * KURO::COGNITIVE SNAPSHOTS v1.0
 * 
 * Save, restore, and branch entire project states.
 * Commercial AI has a sliding context window. KURO has time travel.
 * 
 * A snapshot captures:
 *   1. File tree manifest (paths + hashes, not full content for size)
 *   2. Session context (last N messages)
 *   3. Active model + mode
 *   4. Git state (branch, HEAD, dirty files) if available
 *   5. User metadata (label, timestamp, parent snapshot)
 * 
 * Branching: Create a snapshot, make changes, then restore to the
 * snapshot point to try a different approach. Merge later.
 * 
 * Storage: /var/lib/kuro/snapshots/{sessionId}/{snapshotId}.json
 * 
 * v7.0.2b — Extracted from Gemini "Quantum-State Cognitive Branching"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const MAX_SNAPSHOTS_PER_SESSION = 20;
const MAX_CONTEXT_MESSAGES = 30;

// ═══════════════════════════════════════════════════════════════════════════
// FILESYSTEM MANIFEST
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a manifest of a project directory.
 * Captures paths + SHA-256 hashes + sizes. Not full file content (too large).
 * Full restore requires git or backup — this is for state comparison.
 */
function buildManifest(projectPath, maxFiles = 500) {
  const manifest = [];
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.kuro']);

  function walk(dir, depth = 0) {
    if (depth > 8 || manifest.length >= maxFiles) return;
    
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } 
    catch { return; }

    for (const entry of entries) {
      if (manifest.length >= maxFiles) break;
      if (entry.name.startsWith('.') && depth > 0) continue;
      if (ignoreDirs.has(entry.name)) continue;

      const full = path.join(dir, entry.name);
      const rel = path.relative(projectPath, full);

      if (entry.isDirectory()) {
        manifest.push({ path: rel, type: 'dir' });
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          // Only hash files under 1MB
          let hash = null;
          if (stat.size < 1048576) {
            const content = fs.readFileSync(full);
            hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
          }
          manifest.push({ path: rel, type: 'file', size: stat.size, hash, modified: stat.mtimeMs });
        } catch { /* skip unreadable */ }
      }
    }
  }

  walk(projectPath);
  return manifest;
}

// ═══════════════════════════════════════════════════════════════════════════
// GIT STATE
// ═══════════════════════════════════════════════════════════════════════════

function getGitState(projectPath) {
  try {
    const opts = { cwd: projectPath, timeout: 5000, encoding: 'utf8' };
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).trim();
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
    const status = execFileSync('git', ['status', '--porcelain'], opts).trim();
    const dirty = status.split('\n').filter(Boolean);

    return {
      available: true,
      branch,
      head,
      dirty: dirty.length,
      dirtyFiles: dirty.slice(0, 20).map(l => l.trim())
    };
  } catch {
    return { available: false };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

function sessionSnapDir(sessionId) {
  const dir = path.join(SNAP_DIR, sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a snapshot of current project + session state.
 */
function createSnapshot(sessionId, projectPath, context = {}) {
  const snapId = `snap_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  
  const snapshot = {
    id: snapId,
    sessionId,
    label: context.label || `Snapshot ${new Date().toISOString().slice(0, 19)}`,
    parentId: context.parentId || null,   // For branching
    timestamp: Date.now(),
    projectPath,
    
    // State captures
    manifest: buildManifest(projectPath),
    git: getGitState(projectPath),
    
    context: {
      messages: (context.messages || []).slice(-MAX_CONTEXT_MESSAGES),
      mode: context.mode || 'main',
      model: context.model || 'kuro-core',
      skill: context.skill || null,
      temperature: context.temperature || 0.7
    },
    
    metadata: {
      fileCount: 0,  // set below
      totalSize: 0,
      createdBy: context.userId || 'system'
    }
  };

  // Compute metadata
  const files = snapshot.manifest.filter(e => e.type === 'file');
  snapshot.metadata.fileCount = files.length;
  snapshot.metadata.totalSize = files.reduce((s, f) => s + (f.size || 0), 0);

  // Save
  const snapPath = path.join(sessionSnapDir(sessionId), `${snapId}.json`);
  fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));

  return { id: snapId, label: snapshot.label, timestamp: snapshot.timestamp, fileCount: snapshot.metadata.fileCount };
}

/**
 * List all snapshots for a session.
 */
function listSnapshots(sessionId) {
  const dir = sessionSnapDir(sessionId);
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const snap = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return {
            id: snap.id,
            label: snap.label,
            timestamp: snap.timestamp,
            parentId: snap.parentId,
            fileCount: snap.metadata?.fileCount,
            mode: snap.context?.mode,
            model: snap.context?.model,
            git: snap.git?.available ? { branch: snap.git.branch, head: snap.git.head } : null
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/**
 * Load a snapshot by ID.
 */
function loadSnapshot(sessionId, snapId) {
  const snapPath = path.join(sessionSnapDir(sessionId), `${snapId}.json`);
  try {
    return JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * Compare two snapshots — show what changed.
 */
function diffSnapshots(sessionId, snapIdA, snapIdB) {
  const a = loadSnapshot(sessionId, snapIdA);
  const b = loadSnapshot(sessionId, snapIdB);
  if (!a || !b) return { error: 'Snapshot not found' };

  const manifestA = new Map(a.manifest.filter(e => e.type === 'file').map(e => [e.path, e]));
  const manifestB = new Map(b.manifest.filter(e => e.type === 'file').map(e => [e.path, e]));

  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  for (const [p, entry] of manifestB) {
    if (!manifestA.has(p)) {
      added.push(p);
    } else if (manifestA.get(p).hash !== entry.hash) {
      modified.push(p);
    } else {
      unchanged.push(p);
    }
  }

  for (const p of manifestA.keys()) {
    if (!manifestB.has(p)) removed.push(p);
  }

  return {
    from: { id: a.id, label: a.label, timestamp: a.timestamp },
    to: { id: b.id, label: b.label, timestamp: b.timestamp },
    added: added.length,
    removed: removed.length,
    modified: modified.length,
    unchanged: unchanged.length,
    files: { added, removed, modified }
  };
}

/**
 * Delete a snapshot.
 */
function deleteSnapshot(sessionId, snapId) {
  const snapPath = path.join(sessionSnapDir(sessionId), `${snapId}.json`);
  try {
    fs.unlinkSync(snapPath);
    return { deleted: true, id: snapId };
  } catch (e) {
    return { deleted: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RESTORE — Replay context to recreate session state
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Restore session context from a snapshot.
 * Does NOT restore filesystem — that's git's job.
 * Returns the context messages and model config to reinject into the session.
 */
function restoreContext(sessionId, snapId) {
  const snap = loadSnapshot(sessionId, snapId);
  if (!snap) return null;

  return {
    snapshotId: snap.id,
    label: snap.label,
    messages: snap.context.messages,
    mode: snap.context.mode,
    model: snap.context.model,
    skill: snap.context.skill,
    temperature: snap.context.temperature,
    git: snap.git?.available ? {
      branch: snap.git.branch,
      head: snap.git.head,
      restoreCmd: `git checkout ${snap.git.head}`
    } : null,
    restoredAt: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS ROUTE MOUNTER
// ═══════════════════════════════════════════════════════════════════════════

function mountSnapshotRoutes(app) {
  // Create snapshot
  app.post('/api/snapshots', (req, res) => {
    const { sessionId, projectPath, label, mode, model, messages, userId } = req.body;
    if (!sessionId || !projectPath) return res.status(400).json({ error: 'sessionId and projectPath required' });

    try {
      const snap = createSnapshot(sessionId, projectPath, { label, mode, model, messages, userId });
      res.json({ success: true, snapshot: snap });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // List snapshots for session
  app.get('/api/snapshots/:sessionId', (req, res) => {
    res.json({ snapshots: listSnapshots(req.params.sessionId) });
  });

  // Load specific snapshot
  app.get('/api/snapshots/:sessionId/:snapId', (req, res) => {
    const snap = loadSnapshot(req.params.sessionId, req.params.snapId);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    res.json(snap);
  });

  // Diff two snapshots
  app.get('/api/snapshots/:sessionId/diff/:snapA/:snapB', (req, res) => {
    const diff = diffSnapshots(req.params.sessionId, req.params.snapA, req.params.snapB);
    res.json(diff);
  });

  // Restore context from snapshot
  app.post('/api/snapshots/:sessionId/:snapId/restore', (req, res) => {
    const context = restoreContext(req.params.sessionId, req.params.snapId);
    if (!context) return res.status(404).json({ error: 'Snapshot not found' });
    res.json({ restored: true, context });
  });

  // Delete snapshot
  app.delete('/api/snapshots/:sessionId/:snapId', (req, res) => {
    res.json(deleteSnapshot(req.params.sessionId, req.params.snapId));
  });

  console.log('[SNAPSHOTS] Routes mounted: /api/snapshots/{:sessionId,:snapId,diff,restore}');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  createSnapshot,
  listSnapshots,
  loadSnapshot,
  diffSnapshots,
  deleteSnapshot,
  restoreContext,
  buildManifest,
  getGitState,
  mountSnapshotRoutes
};
