'use strict';
/**
 * search_ops self-test — run with: node layers/search/search_ops.test.cjs
 */

const Database = require('better-sqlite3');
const { validateQuery, searchFiles, MAX_RESULTS, MAX_Q_LEN } = require('./search_ops.cjs');

let passed = 0, failed = 0;

function assert(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (e) { console.error(`  ✗  ${name}: ${e.message}`); failed++; }
}

async function assertAsync(name, fn) {
  try { await fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (e) { console.error(`  ✗  ${name}: ${e.message}`); failed++; }
}

// ── In-memory DB ──────────────────────────────────────────────────────────────

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id    TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL
  );
  CREATE TABLE vfs_files (
    id       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id  TEXT NOT NULL,
    path     TEXT NOT NULL,
    size     INTEGER DEFAULT 0,
    is_dir   INTEGER DEFAULT 0,
    UNIQUE(user_id, path)
  );
  CREATE TABLE projects (
    id       TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL,
    name     TEXT,
    vfs_path TEXT
  );
`);

db.prepare("INSERT INTO users (id, email) VALUES ('user-A', 'a@test.com')").run();
db.prepare("INSERT INTO users (id, email) VALUES ('user-B', 'b@test.com')").run();

function seedFile(userId, path) {
  db.prepare("INSERT OR IGNORE INTO vfs_files (user_id, path, is_dir) VALUES (?, ?, 0)").run(userId, path);
}

// ── Mock VFS adapter factory ──────────────────────────────────────────────────
// getAdapter(userId) → adapter; adapter.read(path) → { content: Buffer }
function makeMockAdapterFactory(fileMap) {
  return (_userId) => ({
    read(p) {
      if (!fileMap[p]) return Promise.reject(new Error(`NOT_FOUND: ${p}`));
      const buf = Buffer.from(fileMap[p]);
      return Promise.resolve({ content: buf, mimeType: 'text/plain', size: buf.length });
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n[search_ops.test] Running 3 tests…\n');

(async () => {

  // 1. Result cap enforced
  await assertAsync('Result cap enforced at MAX_RESULTS', async () => {
    // 200 matching lines → should cap at MAX_RESULTS (100)
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}: needle here`).join('\n');
    seedFile('user-A', '/cap-test.txt');
    const { results, capped } = await searchFiles({
      db,
      userId: 'user-A',
      q: 'needle',
      getAdapter: makeMockAdapterFactory({ '/cap-test.txt': lines }),
    });
    if (results.length !== MAX_RESULTS) throw new Error(`Expected ${MAX_RESULTS}, got ${results.length}`);
    if (!capped) throw new Error('capped flag should be true');
  });

  // 2. Cross-user isolation
  await assertAsync('Cross-user isolation: user-A cannot see user-B files', async () => {
    seedFile('user-A', '/a-private.txt');
    seedFile('user-B', '/b-private.txt');
    const fileMap = {
      '/a-private.txt': 'user-a needle secret',
      '/b-private.txt': 'user-b needle secret',
    };
    const { results } = await searchFiles({
      db,
      userId: 'user-A',
      q: 'needle',
      getAdapter: makeMockAdapterFactory(fileMap),
    });
    const files = results.map(r => r.file);
    if (files.includes('/b-private.txt')) throw new Error('Cross-user data leaked!');
    if (!files.includes('/a-private.txt')) throw new Error('Own file not found in results');
  });

  // 3. Large query safe
  assert(`Large query (>${MAX_Q_LEN} chars) throws`, () => {
    const longQ = 'x'.repeat(MAX_Q_LEN + 1);
    try {
      validateQuery(longQ);
      throw new Error('Should have thrown but did not');
    } catch (e) {
      if (!e.message.includes('too long')) throw e; // rethrow unexpected errors
    }
  });

  console.log(`\n[search_ops.test] ${passed}/${passed + failed} passed\n`);
  if (failed > 0) process.exit(1);

})().catch(e => {
  console.error('[search_ops.test] Fatal:', e.message);
  process.exit(1);
});
