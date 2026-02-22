'use strict';
/**
 * KURO::SEARCH Routes — Phase 6
 * Mounted at /api/search by server.cjs
 */

const express = require('express');
const { validateQuery, searchFiles } = require('./search_ops.cjs');

let S3VfsAdapter;
try { ({ S3VfsAdapter } = require('../vfs/vfs_s3_adapter.cjs')); } catch { /* optional */ }

function defaultGetAdapter(userId) {
  if (!S3VfsAdapter) throw new Error('VFS adapter unavailable');
  return new S3VfsAdapter(userId);
}

module.exports = function mountSearchRoutes(auth, { db, getAdapter = defaultGetAdapter } = {}) {
  const router = express.Router();

  // GET /api/search?q=<query>[&projectId=<id>][&path=<prefix>]
  router.get('/', auth.required, async (req, res) => {
    const userId = req.user?.userId;
    if (!userId || userId === 'anon' || userId === 'guest') {
      return res.status(401).json({ error: 'Auth required' });
    }

    // Validate query
    let q;
    try { q = validateQuery(req.query.q); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    // Resolve scope
    let scopePath = null;
    const { projectId, path: pathParam } = req.query;

    if (projectId) {
      // Always verify ownership — user_id = userId prevents cross-user access
      const project = db.prepare(
        'SELECT vfs_path FROM projects WHERE id = ? AND user_id = ?'
      ).get(projectId, userId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      scopePath = project.vfs_path || null;
    }

    if (pathParam && !scopePath) {
      // Lightweight path-scope sanitization
      if (pathParam.includes('..') || pathParam.includes('\0')) {
        return res.status(400).json({ error: 'Invalid path parameter' });
      }
      scopePath = pathParam;
    }

    try {
      const { results, capped } = await searchFiles({
        db, userId, q, scopePath, getAdapter,
      });
      return res.json({ results, count: results.length, capped });
    } catch (e) {
      console.error('[SEARCH] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
};
