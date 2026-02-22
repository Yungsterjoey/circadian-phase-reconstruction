'use strict';
/**
 * KURO::SEARCH — Core search operations (no HTTP, pure logic + DB)
 * Phase 6
 */

const MAX_RESULTS    = 100;
const MAX_FILE_BYTES = 1 * 1024 * 1024;  // 1 MB per file — skip larger
const MAX_FILES_SCAN = 500;              // max files to scan per query
const MAX_Q_LEN      = 200;

// Skip known binary extensions
const BINARY_EXTS = new Set([
  'png','jpg','jpeg','gif','webp','svg','ico','bmp','tiff',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'zip','tar','gz','bz2','7z','rar','xz',
  'mp3','mp4','avi','mov','mkv','webm','ogg','flac','wav',
  'wasm','bin','exe','dll','so','dylib',
  'ttf','woff','woff2','eot','otf',
  'db','sqlite','lock','pyc',
]);

// ── Validation ────────────────────────────────────────────────────────────────

function validateQuery(q) {
  if (!q || typeof q !== 'string') throw new Error('q is required');
  const trimmed = q.trim();
  if (!trimmed) throw new Error('q must not be empty');
  if (trimmed.length > MAX_Q_LEN) throw new Error(`q too long (max ${MAX_Q_LEN} chars)`);
  if (trimmed.includes('\0')) throw new Error('q must not contain null bytes');
  return trimmed;
}

// ── Pattern builder — safe regex, literal fallback ────────────────────────────

function buildPattern(q) {
  try {
    return new RegExp(q, 'i');
  } catch {
    // Invalid regex — treat as literal string
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

// ── Main search ───────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object}   opts.db          — better-sqlite3 instance
 * @param {string}   opts.userId      — authenticated user (cross-user safety anchor)
 * @param {string}   opts.q           — already-validated query string
 * @param {string}  [opts.scopePath]  — restrict to this VFS path prefix
 * @param {function} opts.getAdapter  — (userId) → VfsAdapter-like { read(path) }
 * @param {number}  [opts.maxResults] — override MAX_RESULTS (for tests)
 * @returns {Promise<{results: Array, capped: boolean}>}
 */
async function searchFiles({ db, userId, q, scopePath = null, getAdapter, maxResults = MAX_RESULTS }) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');

  const pattern = buildPattern(q);

  // ── File list from DB — always anchored to user_id ───────────────────────
  let fileRows;
  if (scopePath) {
    const prefix = scopePath.replace(/\/$/, '') + '/%';
    fileRows = db.prepare(`
      SELECT path FROM vfs_files
      WHERE user_id = ? AND is_dir = 0 AND (path = ? OR path LIKE ?)
      ORDER BY path
      LIMIT ?
    `).all(userId, scopePath, prefix, MAX_FILES_SCAN);
  } else {
    fileRows = db.prepare(`
      SELECT path FROM vfs_files
      WHERE user_id = ? AND is_dir = 0
      ORDER BY path
      LIMIT ?
    `).all(userId, MAX_FILES_SCAN);
  }

  const adapter = getAdapter(userId);
  const results = [];

  for (const { path: filePath } of fileRows) {
    if (results.length >= maxResults) break;

    // Skip binary files by extension
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    if (BINARY_EXTS.has(ext)) continue;

    // Read file content
    let content;
    try {
      const { content: buf } = await adapter.read(filePath);
      if (buf.length > MAX_FILE_BYTES) continue;
      content = buf.toString('utf8');
    } catch {
      continue; // unreadable (S3 not configured, deleted, etc.) — skip gracefully
    }

    // Search line by line
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
      if (pattern.test(lines[i])) {
        results.push({
          file:    filePath,
          line:    i + 1,
          preview: lines[i].slice(0, 200),
        });
      }
    }
  }

  return { results, capped: results.length >= maxResults };
}

module.exports = { validateQuery, buildPattern, searchFiles, MAX_RESULTS, MAX_Q_LEN };
