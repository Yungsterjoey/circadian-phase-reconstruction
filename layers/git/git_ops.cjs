'use strict';
/**
 * KURO::GIT — Core patch operations (no HTTP, pure logic + DB)
 * Phase 5
 */

const { parsePatch, applyPatch, createPatch } = require('diff');

// ─── Path validation ──────────────────────────────────────────────────────────

/**
 * Validates a VFS path. Allows absolute-style /my/file.py VFS paths.
 * Rejects filesystem escapes (../) and empty / non-string values.
 */
function validateVfsPath(p) {
  if (!p || typeof p !== 'string') throw new Error('VFS path must be a non-empty string');
  if (p.includes('..')) throw new Error('VFS path must not contain ".."');
  // Must start with / for VFS absolute paths
  if (!p.startsWith('/')) throw new Error('VFS path must start with /');
  // Guard against null bytes
  if (p.includes('\0')) throw new Error('VFS path must not contain null bytes');
}

// ─── Audit log ───────────────────────────────────────────────────────────────

function logOp(db, userId, operation, status, meta) {
  db.prepare(`
    INSERT INTO git_ops (user_id, ts, operation, status, metadata_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, Date.now(), operation, status, JSON.stringify(meta || {}));
}

// ─── Diff (preview) ──────────────────────────────────────────────────────────

function opDiff(original, patch, filename) {
  const parsed = parsePatch(patch);
  if (!parsed || parsed.length === 0) throw new Error('Invalid or empty patch');

  let additions = 0;
  let deletions = 0;
  const hunks = [];

  for (const file of parsed) {
    for (const hunk of (file.hunks || [])) {
      let adds = 0, dels = 0;
      for (const line of (hunk.lines || [])) {
        if (line.startsWith('+')) adds++;
        else if (line.startsWith('-')) dels++;
      }
      additions += adds;
      deletions += dels;
      hunks.push({ header: hunk.header, additions: adds, deletions: dels });
    }
  }

  // Also compute the new content for preview
  let newContent = null;
  try {
    newContent = applyPatch(original, patch);
    if (newContent === false) newContent = null;
  } catch (_) {
    // preview failure is non-fatal
  }

  return {
    files: parsed.map(f => f.newFileName || f.oldFileName || filename || 'unknown'),
    additions,
    deletions,
    hunks,
    newContent,
  };
}

// ─── Apply ───────────────────────────────────────────────────────────────────

function opApply(original, patch) {
  const result = applyPatch(original, patch);
  if (result === false) throw new Error('Patch did not apply cleanly — check offsets/context');
  return result;
}

// ─── Branch (snapshot upsert) ────────────────────────────────────────────────

function opBranch(db, userId, vfsPath, branch, content) {
  const row = db.prepare(`
    INSERT INTO git_snapshots (user_id, branch_name, vfs_path, content, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, branch_name, vfs_path) DO UPDATE SET
      content    = excluded.content,
      created_at = excluded.created_at
    RETURNING id
  `).get(userId, branch, vfsPath, content, Date.now());
  return row.id;
}

// ─── Rollback ────────────────────────────────────────────────────────────────

function opRollback(db, userId, vfsPath, branch) {
  const row = db.prepare(`
    SELECT content FROM git_snapshots
    WHERE user_id = ? AND vfs_path = ? AND branch_name = ?
  `).get(userId, vfsPath, branch);
  if (!row) throw new Error(`Snapshot not found: branch="${branch}" path="${vfsPath}"`);
  return row.content;
}

// ─── List branches ───────────────────────────────────────────────────────────

function opListBranches(db, userId, vfsPath) {
  return db.prepare(`
    SELECT id, branch_name AS branchName, created_at AS createdAt
    FROM git_snapshots
    WHERE user_id = ? AND vfs_path = ?
    ORDER BY created_at DESC
  `).all(userId, vfsPath);
}

module.exports = {
  validateVfsPath,
  logOp,
  opDiff,
  opApply,
  opBranch,
  opRollback,
  opListBranches,
};
