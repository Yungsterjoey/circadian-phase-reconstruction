'use strict';
/**
 * git_ops self-test — run with: node layers/git/git_ops.test.cjs
 */

const Database = require('better-sqlite3');
const { validateVfsPath, logOp, opDiff, opApply, opBranch, opRollback, opListBranches } = require('./git_ops.cjs');

let passed = 0;
let failed = 0;

function assert(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}: ${e.message}`);
    failed++;
  }
}

function assertThrows(name, fn) {
  try {
    fn();
    console.error(`  ✗  ${name}: expected throw but did not throw`);
    failed++;
  } catch (_) {
    console.log(`  ✓  ${name}`);
    passed++;
  }
}

// ── In-memory DB setup ────────────────────────────────────────────────────────

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE users (
    id   TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL
  );
  CREATE TABLE git_ops (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts            INTEGER NOT NULL,
    operation     TEXT NOT NULL CHECK(operation IN ('diff','apply','branch','rollback')),
    status        TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','error','pending')),
    metadata_json TEXT DEFAULT '{}'
  );
  CREATE TABLE git_snapshots (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_name TEXT NOT NULL,
    vfs_path    TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE(user_id, branch_name, vfs_path)
  );
`);

// Seed two users
db.prepare("INSERT INTO users (id, email) VALUES ('user-A', 'a@test.com')").run();
db.prepare("INSERT INTO users (id, email) VALUES ('user-B', 'b@test.com')").run();

// ── Test data ─────────────────────────────────────────────────────────────────

const src = `line1\nline2\nline3\n`;

// Valid unified diff that changes "line2" → "lineX"
const validPatch = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+lineX
 line3
`;

// A patch that won't apply to src (wrong context)
const badPatch = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 WRONG_CONTEXT
-line2
+lineX
 line3
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n[git_ops.test] Running 5 tests…\n');

// 1. Patch apply works
assert('Patch apply returns expected output', () => {
  const result = opApply(src, validPatch);
  if (result !== 'line1\nlineX\nline3\n') {
    throw new Error(`Unexpected result: ${JSON.stringify(result)}`);
  }
});

// 2. Invalid patch rejected
assertThrows('Invalid patch throws', () => {
  opApply(src, badPatch);
});

// 3. Path validation
assertThrows('validateVfsPath rejects ../etc/passwd', () => validateVfsPath('../etc/passwd'));
assert('validateVfsPath accepts /my/file.py', () => validateVfsPath('/my/file.py'));

// 4. Cross-user isolation
assert('opListBranches returns only user-A branches', () => {
  opBranch(db, 'user-A', '/shared/file.py', 'main', 'content-A');
  opBranch(db, 'user-B', '/shared/file.py', 'main', 'content-B');
  const branches = opListBranches(db, 'user-A', '/shared/file.py');
  if (branches.length !== 1) throw new Error(`Expected 1 branch, got ${branches.length}`);
  if (branches[0].branchName !== 'main') throw new Error('Wrong branch name');
});

// 5. Snapshot round-trip
assert('opBranch → opRollback returns same content', () => {
  opBranch(db, 'user-A', '/my/file.txt', 'pre-fix', 'hello world');
  const content = opRollback(db, 'user-A', '/my/file.txt', 'pre-fix');
  if (content !== 'hello world') throw new Error(`Got: ${JSON.stringify(content)}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n[git_ops.test] ${passed}/${passed + failed} passed\n`);
if (failed > 0) process.exit(1);
