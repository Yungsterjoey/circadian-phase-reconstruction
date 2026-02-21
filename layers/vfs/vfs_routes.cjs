/**
 * KURO VFS Routes v1.0
 *
 * Mount: app.use('/api/vfs', require('./layers/vfs/vfs_routes.cjs')(auth, { db }))
 *
 * All routes require auth.required. Guests (anon userId) receive 401.
 */

const express             = require('express');
const { VfsAdapterError } = require('./vfs_adapter.interface.cjs');
const { S3VfsAdapter }    = require('./vfs_s3_adapter.cjs');
const { NextcloudVfsAdapter } = require('./vfs_nextcloud_adapter.cjs');

const BACKEND = process.env.VFS_BACKEND || 's3';

// Per-tier soft quota limits (bytes)
const QUOTA_LIMITS = {
  free:      100  * 1024 * 1024,        //  100 MB
  pro:       10   * 1024 * 1024 * 1024, //   10 GB
  sovereign: 100  * 1024 * 1024 * 1024, //  100 GB
};

function getAdapter(userId) {
  if (BACKEND === 'nextcloud') return new NextcloudVfsAdapter(userId);
  return new S3VfsAdapter(userId);
}

function vfsErr(res, err) {
  if (err instanceof VfsAdapterError) {
    const statusMap = {
      NOT_FOUND:         404,
      PERMISSION_DENIED: 403,
      QUOTA_EXCEEDED:    413,
      CONFLICT:          409,
      NOT_IMPLEMENTED:   501,
    };
    return res.status(statusMap[err.code] || 500).json({ error: err.message, code: err.code });
  }
  console.error('[VFS] Unexpected:', err.message);
  return res.status(500).json({ error: 'Internal VFS error' });
}

function userId(req) { return req.user?.userId; }

function mountVfsRoutes(auth, { db }) {
  const router = express.Router();

  // All VFS routes require a real session (no anon)
  router.use(auth.required);
  router.use((req, res, next) => {
    const uid = userId(req);
    if (!uid || uid === 'anon' || uid === 'guest') {
      return res.status(401).json({ error: 'Auth required for VFS' });
    }
    next();
  });

  // ── GET /api/vfs/list?path= ───────────────────────────────────────────────
  router.get('/list', async (req, res) => {
    try {
      const adapter = getAdapter(userId(req));
      const entries = await adapter.list(req.query.path || '');
      res.json({ entries, path: req.query.path || '/' });
    } catch (e) { vfsErr(res, e); }
  });

  // ── GET /api/vfs/read?path= ───────────────────────────────────────────────
  router.get('/read', async (req, res) => {
    if (!req.query.path) return res.status(400).json({ error: 'path required' });
    try {
      const adapter = getAdapter(userId(req));
      const { content, mimeType, size } = await adapter.read(req.query.path);
      res.set('Content-Type', mimeType);
      res.set('Content-Length', String(size));
      res.send(content);
    } catch (e) { vfsErr(res, e); }
  });

  // ── POST /api/vfs/write  { path, content, encoding?, mimeType? } ──────────
  router.post('/write', async (req, res) => {
    const { path: p, content, encoding, mimeType } = req.body || {};
    if (!p || content === undefined) return res.status(400).json({ error: 'path and content required' });

    const uid   = userId(req);
    const tier  = req.user?.tier || 'free';
    const limit = QUOTA_LIMITS[tier] ?? QUOTA_LIMITS.free;

    // Quota check
    const quotaRow = db.prepare('SELECT used_bytes FROM vfs_quotas WHERE user_id = ?').get(uid);
    const used     = quotaRow?.used_bytes || 0;
    const size     = Buffer.byteLength(String(content), encoding || 'utf8');
    if (used + size > limit) {
      return res.status(413).json({ error: 'Quota exceeded', used, limit, code: 'QUOTA_EXCEEDED' });
    }

    try {
      const adapter = getAdapter(uid);
      const result  = await adapter.write(p, content, { encoding, mimeType });

      // Update quota
      db.prepare(`
        INSERT INTO vfs_quotas (user_id, limit_bytes, used_bytes, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          used_bytes = used_bytes + ?, updated_at = CURRENT_TIMESTAMP
      `).run(uid, limit, size, size);

      // Track file metadata
      db.prepare(`
        INSERT INTO vfs_files (id, user_id, path, size, mime_type, backend, s3_key, is_dir, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, path) DO UPDATE SET
          size=excluded.size, mime_type=excluded.mime_type, updated_at=CURRENT_TIMESTAMP
      `).run(uid, p, result.size, mimeType || 'application/octet-stream', BACKEND, `users/${uid}/${p}`);

      res.json({ ok: true, size: result.size, etag: result.etag || null });
    } catch (e) { vfsErr(res, e); }
  });

  // ── POST /api/vfs/mkdir  { path } ────────────────────────────────────────
  router.post('/mkdir', async (req, res) => {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path required' });
    const uid = userId(req);
    try {
      const adapter = getAdapter(uid);
      await adapter.mkdir(p);

      db.prepare(`
        INSERT OR IGNORE INTO vfs_files
          (id, user_id, path, size, mime_type, backend, s3_key, is_dir, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), ?, ?, 0, 'inode/directory', ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(uid, p, BACKEND, `users/${uid}/${p}/`);

      res.json({ ok: true });
    } catch (e) { vfsErr(res, e); }
  });

  // ── DELETE /api/vfs/rm?path=&recursive= ──────────────────────────────────
  router.delete('/rm', async (req, res) => {
    const p = req.query.path;
    if (!p) return res.status(400).json({ error: 'path required' });
    const recursive = req.query.recursive === 'true';
    const uid = userId(req);

    // Calculate size being freed for quota update
    let freedBytes = 0;
    if (recursive) {
      const rows = db.prepare("SELECT size FROM vfs_files WHERE user_id = ? AND (path = ? OR path LIKE ?)").all(uid, p, p + '/%');
      freedBytes = rows.reduce((s, r) => s + (r.size || 0), 0);
    } else {
      const row = db.prepare("SELECT size FROM vfs_files WHERE user_id = ? AND path = ?").get(uid, p);
      freedBytes = row?.size || 0;
    }

    try {
      const adapter = getAdapter(uid);
      await adapter.rm(p, recursive);

      if (recursive) {
        db.prepare("DELETE FROM vfs_files WHERE user_id = ? AND (path = ? OR path LIKE ?)").run(uid, p, p + '/%');
      } else {
        db.prepare("DELETE FROM vfs_files WHERE user_id = ? AND path = ?").run(uid, p);
      }

      if (freedBytes > 0) {
        db.prepare("UPDATE vfs_quotas SET used_bytes = MAX(0, used_bytes - ?), updated_at = CURRENT_TIMESTAMP WHERE user_id = ?")
          .run(freedBytes, uid);
      }

      res.json({ ok: true });
    } catch (e) { vfsErr(res, e); }
  });

  // ── POST /api/vfs/mv  { src, dst } ───────────────────────────────────────
  router.post('/mv', async (req, res) => {
    const { src, dst } = req.body || {};
    if (!src || !dst) return res.status(400).json({ error: 'src and dst required' });
    const uid = userId(req);
    try {
      const adapter = getAdapter(uid);
      await adapter.mv(src, dst);

      db.prepare(`
        UPDATE vfs_files SET path = ?, s3_key = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND path = ?
      `).run(dst, `users/${uid}/${dst}`, uid, src);

      res.json({ ok: true });
    } catch (e) { vfsErr(res, e); }
  });

  // ── GET /api/vfs/stat?path= ───────────────────────────────────────────────
  router.get('/stat', async (req, res) => {
    if (!req.query.path) return res.status(400).json({ error: 'path required' });
    try {
      const adapter = getAdapter(userId(req));
      const stat = await adapter.stat(req.query.path);
      res.json(stat);
    } catch (e) { vfsErr(res, e); }
  });

  // ── GET /api/vfs/quota ────────────────────────────────────────────────────
  router.get('/quota', (req, res) => {
    const uid   = userId(req);
    const tier  = req.user?.tier || 'free';
    const limit = QUOTA_LIMITS[tier] ?? QUOTA_LIMITS.free;
    const row   = db.prepare('SELECT used_bytes FROM vfs_quotas WHERE user_id = ?').get(uid);
    res.json({ used: row?.used_bytes || 0, limit, tier });
  });

  return router;
}

module.exports = mountVfsRoutes;
