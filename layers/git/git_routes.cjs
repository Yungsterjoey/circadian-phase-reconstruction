'use strict';
/**
 * KURO::GIT — HTTP routes
 * Phase 5
 *
 * Mounted at /api/git by server.cjs
 * Pattern mirrors sandbox_routes.cjs
 */

const express = require('express');
const { validateVfsPath, logOp, opDiff, opApply, opBranch, opRollback, opListBranches } = require('./git_ops.cjs');

// ─── VFS write helper ────────────────────────────────────────────────────────

async function vfsWrite(token, vfsPath, content, port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/vfs/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-KURO-Token': token },
    body: JSON.stringify({ path: vfsPath, content }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'VFS write failed');
  }
}

// ─── Router factory ──────────────────────────────────────────────────────────

module.exports = function mountGitRoutes(auth, { db }) {
  const router = express.Router();
  const PORT = process.env.PORT || 3000;

  // ── POST /diff — preview patch without applying ──────────────────────────
  router.post('/diff', auth.required, async (req, res) => {
    const { path: vfsPath, original, patch } = req.body || {};
    const userId = req.user.userId;
    try {
      validateVfsPath(vfsPath);
      if (typeof original !== 'string') return res.status(400).json({ error: 'original must be a string' });
      if (typeof patch !== 'string') return res.status(400).json({ error: 'patch must be a string' });

      const result = opDiff(original, patch, vfsPath);
      logOp(db, userId, 'diff', 'ok', { path: vfsPath, additions: result.additions, deletions: result.deletions });
      return res.json(result);
    } catch (e) {
      logOp(db, userId, 'diff', 'error', { path: vfsPath, error: e.message });
      return res.status(400).json({ error: e.message });
    }
  });

  // ── POST /apply — apply patch and write to VFS ───────────────────────────
  router.post('/apply', auth.required, async (req, res) => {
    const { path: vfsPath, original, patch } = req.body || {};
    const userId = req.user.userId;
    const token = req.headers['x-kuro-token'] || req.cookies?.kuro_token;
    try {
      validateVfsPath(vfsPath);
      if (typeof original !== 'string') return res.status(400).json({ error: 'original must be a string' });
      if (typeof patch !== 'string') return res.status(400).json({ error: 'patch must be a string' });

      const newContent = opApply(original, patch);
      await vfsWrite(token, vfsPath, newContent, PORT);
      logOp(db, userId, 'apply', 'ok', { path: vfsPath });
      return res.json({ ok: true, newContent });
    } catch (e) {
      logOp(db, userId, 'apply', 'error', { path: vfsPath, error: e.message });
      return res.status(400).json({ error: e.message });
    }
  });

  // ── GET /branch?path= — list snapshots for a path ───────────────────────
  router.get('/branch', auth.required, (req, res) => {
    const vfsPath = req.query.path;
    const userId = req.user.userId;
    try {
      validateVfsPath(vfsPath);
      const branches = opListBranches(db, userId, vfsPath);
      return res.json({ branches });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  });

  // ── POST /branch — create/update a named snapshot ───────────────────────
  router.post('/branch', auth.required, (req, res) => {
    const { path: vfsPath, branch, content } = req.body || {};
    const userId = req.user.userId;
    try {
      validateVfsPath(vfsPath);
      if (!branch || typeof branch !== 'string') return res.status(400).json({ error: 'branch name required' });
      if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });

      const id = opBranch(db, userId, vfsPath, branch, content);
      logOp(db, userId, 'branch', 'ok', { path: vfsPath, branch });
      return res.json({ ok: true, id });
    } catch (e) {
      logOp(db, userId, 'branch', 'error', { path: vfsPath, error: e.message });
      return res.status(400).json({ error: e.message });
    }
  });

  // ── POST /rollback — restore snapshot and write to VFS ──────────────────
  router.post('/rollback', auth.required, async (req, res) => {
    const { path: vfsPath, branch } = req.body || {};
    const userId = req.user.userId;
    const token = req.headers['x-kuro-token'] || req.cookies?.kuro_token;
    try {
      validateVfsPath(vfsPath);
      if (!branch || typeof branch !== 'string') return res.status(400).json({ error: 'branch name required' });

      const content = opRollback(db, userId, vfsPath, branch);
      await vfsWrite(token, vfsPath, content, PORT);
      logOp(db, userId, 'rollback', 'ok', { path: vfsPath, branch });
      return res.json({ ok: true, content });
    } catch (e) {
      logOp(db, userId, 'rollback', 'error', { path: vfsPath, error: e.message });
      return res.status(400).json({ error: e.message });
    }
  });

  return router;
};
