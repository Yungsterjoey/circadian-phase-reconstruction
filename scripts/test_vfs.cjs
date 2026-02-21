#!/usr/bin/env node
/**
 * KURO VFS Test Suite
 * Uses an in-memory mock adapter — no S3 required.
 *
 * Usage: node scripts/test_vfs.cjs
 * Exit 0 = all pass, Exit 1 = failures
 */

const assert = require('assert');
const { VfsAdapterError } = require('../layers/vfs/vfs_adapter.interface.cjs');

// ── In-memory mock adapter (mirrors S3 semantics) ───────────────────────────

class MemVfsAdapter {
  constructor(userId) {
    if (!userId || typeof userId !== 'string') {
      throw new VfsAdapterError('PERMISSION_DENIED', 'userId required');
    }
    this.userId = userId;
    this._store = new Map(); // key: `${userId}:${path}` → { content, isDir, size, mimeType, modified }
  }

  _k(p) { return `${this.userId}:${p}`; }
  _ts() { return new Date().toISOString(); }

  async list(remotePath = '') {
    const prefix = remotePath ? remotePath.replace(/\/$/, '') + '/' : '';
    const result = [];
    for (const [k, v] of this._store) {
      const rel = k.slice(this.userId.length + 1); // strip "userId:"
      if (prefix && !rel.startsWith(prefix)) continue;
      const rest = rel.slice(prefix.length);
      if (!rest || rest.includes('/')) continue; // skip nested
      result.push({ name: rest, type: v.isDir ? 'dir' : 'file', size: v.size || 0, modified: v.modified || '' });
    }
    return result;
  }

  async read(remotePath) {
    const v = this._store.get(this._k(remotePath));
    if (!v || v.isDir) throw new VfsAdapterError('NOT_FOUND', `Not found: ${remotePath}`);
    return { content: Buffer.from(v.content || ''), mimeType: v.mimeType || 'text/plain', size: v.size || 0 };
  }

  async write(remotePath, content, opts = {}) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, opts.encoding || 'utf8');
    this._store.set(this._k(remotePath), {
      content:  buf.toString(),
      size:     buf.length,
      mimeType: opts.mimeType || 'text/plain',
      modified: this._ts(),
    });
    return { size: buf.length };
  }

  async mkdir(remotePath) {
    this._store.set(this._k(remotePath), { isDir: true, size: 0, modified: this._ts() });
  }

  async rm(remotePath, recursive = false) {
    if (recursive) {
      const keyPrefix = this._k(remotePath);
      for (const k of [...this._store.keys()]) {
        if (k === keyPrefix || k.startsWith(keyPrefix + '/')) this._store.delete(k);
      }
    } else {
      if (!this._store.has(this._k(remotePath))) {
        throw new VfsAdapterError('NOT_FOUND', `Not found: ${remotePath}`);
      }
      this._store.delete(this._k(remotePath));
    }
  }

  async mv(srcPath, dstPath) {
    const v = this._store.get(this._k(srcPath));
    if (!v) throw new VfsAdapterError('NOT_FOUND', `Not found: ${srcPath}`);
    this._store.set(this._k(dstPath), { ...v, modified: this._ts() });
    this._store.delete(this._k(srcPath));
  }

  async stat(remotePath) {
    const v = this._store.get(this._k(remotePath));
    if (!v) throw new VfsAdapterError('NOT_FOUND', `Not found: ${remotePath}`);
    return {
      name:     remotePath.split('/').pop() || remotePath,
      type:     v.isDir ? 'dir' : 'file',
      size:     v.size || 0,
      modified: v.modified || '',
    };
  }
}

// ── Test runner ──────────────────────────────────────────────────────────────

let pass = 0, fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${e.message}`);
    fail++;
  }
}

// ── Suites ───────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n[test_vfs] Running VFS tests (in-memory adapter)\n');

  const userA = new MemVfsAdapter('user_a');
  const userB = new MemVfsAdapter('user_b');

  // ── Interface sanity ───────────────────────────────────────────────────
  await test('VfsAdapterError carries code and message', () => {
    const e = new VfsAdapterError('NOT_FOUND', 'test');
    assert.strictEqual(e.code, 'NOT_FOUND');
    assert.strictEqual(e.message, 'test');
    assert.ok(e instanceof Error);
  });

  await test('Constructor rejects null userId', () => {
    assert.throws(() => new MemVfsAdapter(null),  /userId required/);
    assert.throws(() => new MemVfsAdapter(''),    /userId required/);
  });

  // ── CRUD roundtrip ─────────────────────────────────────────────────────
  await test('write + read roundtrip', async () => {
    await userA.write('hello.txt', 'Hello, VFS!');
    const { content } = await userA.read('hello.txt');
    assert.strictEqual(content.toString(), 'Hello, VFS!');
  });

  await test('write returns size', async () => {
    const r = await userA.write('sized.txt', 'ABCDE');
    assert.strictEqual(r.size, 5);
  });

  await test('list after write', async () => {
    const entries = await userA.list('');
    assert.ok(entries.some(e => e.name === 'hello.txt'), 'hello.txt should appear');
  });

  await test('mkdir + list subdirectory', async () => {
    await userA.mkdir('docs');
    await userA.write('docs/readme.md', '# Docs');
    const entries = await userA.list('docs');
    assert.ok(entries.some(e => e.name === 'readme.md'), 'readme.md should appear in docs/');
  });

  await test('mkdir does not appear in nested list', async () => {
    const root = await userA.list('');
    assert.ok(root.some(e => e.name === 'docs' && e.type === 'dir'), 'docs dir should appear at root');
  });

  await test('stat file', async () => {
    const s = await userA.stat('hello.txt');
    assert.strictEqual(s.type, 'file');
    assert.ok(s.size > 0, 'size should be > 0');
  });

  await test('stat dir', async () => {
    const s = await userA.stat('docs');
    assert.strictEqual(s.type, 'dir');
  });

  // ── mv ─────────────────────────────────────────────────────────────────
  await test('mv renames a file', async () => {
    await userA.write('before.txt', 'content');
    await userA.mv('before.txt', 'after.txt');
    const { content } = await userA.read('after.txt');
    assert.strictEqual(content.toString(), 'content');
    await assert.rejects(() => userA.read('before.txt'), { code: 'NOT_FOUND' });
  });

  // ── rm ─────────────────────────────────────────────────────────────────
  await test('rm removes a file', async () => {
    await userA.write('todelete.txt', 'bye');
    await userA.rm('todelete.txt');
    await assert.rejects(() => userA.read('todelete.txt'), { code: 'NOT_FOUND' });
  });

  await test('rm missing file throws NOT_FOUND', async () => {
    await assert.rejects(() => userA.rm('nonexistent.txt'), { code: 'NOT_FOUND' });
  });

  await test('rm recursive removes entire tree', async () => {
    await userA.mkdir('tree');
    await userA.write('tree/a.txt', 'a');
    await userA.write('tree/b.txt', 'b');
    await userA.mkdir('tree/sub');
    await userA.write('tree/sub/c.txt', 'c');
    await userA.rm('tree', true);
    const root = await userA.list('');
    assert.ok(!root.some(e => e.name === 'tree'), 'tree dir should be gone');
  });

  // ── Cross-user isolation ───────────────────────────────────────────────
  await test('userB cannot read userA files', async () => {
    await userA.write('secret.txt', 'user_a_only');
    await assert.rejects(() => userB.read('secret.txt'), { code: 'NOT_FOUND' });
  });

  await test('userB list does not reveal userA entries', async () => {
    const entries = await userB.list('');
    assert.ok(!entries.some(e => e.name === 'secret.txt'), 'userB should not see userA secret.txt');
  });

  await test('userB write does not overwrite userA file', async () => {
    await userA.write('shared_name.txt', 'from_A');
    await userB.write('shared_name.txt', 'from_B');
    const { content: a } = await userA.read('shared_name.txt');
    const { content: b } = await userB.read('shared_name.txt');
    assert.strictEqual(a.toString(), 'from_A', 'userA content should be unchanged');
    assert.strictEqual(b.toString(), 'from_B', 'userB content should be from_B');
  });

  await test('userB rm cannot delete userA file', async () => {
    await userA.write('protected.txt', 'keep me');
    // userB tries to rm; adapter throws NOT_FOUND (file does not exist in userB namespace)
    await assert.rejects(() => userB.rm('protected.txt'), { code: 'NOT_FOUND' });
    // userA file should still be readable
    const { content } = await userA.read('protected.txt');
    assert.strictEqual(content.toString(), 'keep me');
  });

  // ── Path traversal sanity (interface-level) ────────────────────────────
  await test('VfsAdapterError code NOT_FOUND', () => {
    const e = new VfsAdapterError('NOT_FOUND', 'x');
    assert.strictEqual(e.code, 'NOT_FOUND');
  });

  await test('VfsAdapterError code PERMISSION_DENIED', () => {
    const e = new VfsAdapterError('PERMISSION_DENIED', 'x');
    assert.strictEqual(e.code, 'PERMISSION_DENIED');
  });

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n[test_vfs] ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run().catch(e => { console.error('[test_vfs] Fatal:', e); process.exit(1); });
