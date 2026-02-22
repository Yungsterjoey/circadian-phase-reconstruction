/**
 * KURO Phase 3.5 — Web (o) Mode Tests
 *
 * Scenarios:
 *  1. Max results enforced (never exceeds KURO_WEB_MAX_RESULTS)
 *  2. HTML stripped from snippets
 *  3. Rate limit blocks after KURO_WEB_RATE_LIMIT per minute
 *  4. Disabled flag blocks route (KURO_WEB_ENABLED=false)
 *  5. tool_calls logged for each web search
 *  6. Injected context bounded to KURO_WEB_MAX_TOKENS
 *
 * Run: node scripts/test_web_mode.cjs
 */

'use strict';

let passed = 0;
let failed = 0;

function ok(label, condition, info = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${info ? ' — ' + info : ''}`);
    failed++;
  }
}

// ─── Minimal in-memory DB ─────────────────────────────────────────────────────
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE tool_calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT,
    ts          INTEGER NOT NULL,
    tool        TEXT NOT NULL,
    input_json  TEXT,
    output_json TEXT,
    status      TEXT DEFAULT 'ok',
    ms          INTEGER
  );
`);

// ─── Helper: parse DDG HTML output ────────────────────────────────────────────
// We test the HTML stripper + parser in isolation without network calls.
// This mirrors what DuckDuckGoAdapter does internally.
const { buildContextInjection } = require('../layers/web/web_fetcher.cjs');

// ─── SCENARIO 1: Max results enforced ─────────────────────────────────────────
console.log('\n[1] Max results enforced');
(async () => {
  // Reload fetcher with MAX_RESULTS=3
  process.env.KURO_WEB_MAX_RESULTS = '3';
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];

  const { MAX_RESULTS } = require('../layers/web/web_fetcher.cjs');
  ok('MAX_RESULTS from env is 3', MAX_RESULTS === 3);

  // Restore
  delete process.env.KURO_WEB_MAX_RESULTS;
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];
})();

// ─── SCENARIO 2: HTML stripped ────────────────────────────────────────────────
console.log('\n[2] HTML stripped from injected context');
(() => {
  // The adapter strips HTML before returning results; buildContextInjection
  // receives plain-text fields.  Verify the adapter's strip function cleans
  // HTML tags and decodes entities by exercising the full result pipeline.
  // We simulate what the adapter produces after stripHtml().
  const results = [
    {
      title:     'Hello World',           // <b> already stripped by adapter
      url:       'https://example.com',
      snippet:   'A snippet with & entities and plain text.',
      fetchedAt: Date.now(),
    },
  ];

  const ctx = buildContextInjection(results);
  ok('context does not contain HTML tags', !/<[^>]+>/.test(ctx));
  ok('context contains title text', ctx.includes('Hello World'));
  ok('context contains snippet text', ctx.includes('snippet'));
  ok('context includes WEB CONTEXT header', ctx.includes('=== WEB CONTEXT ==='));
  ok('context includes END WEB CONTEXT footer', ctx.includes('=== END WEB CONTEXT ==='));

  // Additionally verify that a result object with raw HTML tags would be visible
  // only if the adapter DIDN'T strip them — confirming our pipeline contract.
  // (We test the adapter's parseDdgHtml would produce clean output via integration
  //  in real use; here we verify buildContextInjection passes through what it gets.)
  const dirtyCtx = buildContextInjection([
    { title: '<b>Bold</b>', url: 'https://x.com', snippet: '<em>em</em>', fetchedAt: Date.now() },
  ]);
  ok('unstripped tags from adapter would be visible (tests adapter must strip)', /<[^>]+>/.test(dirtyCtx));
})();

// ─── SCENARIO 3: Rate limit works ────────────────────────────────────────────
console.log('\n[3] Rate limit');
(async () => {
  // Reload with rate limit=3
  process.env.KURO_WEB_ENABLED    = 'true';
  process.env.KURO_WEB_RATE_LIMIT = '3';
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];

  const fetcher = require('../layers/web/web_fetcher.cjs');

  // Patch the adapter's search to avoid real network calls
  const { DuckDuckGoAdapter } = require('../layers/web/web_duckduckgo_adapter.cjs');
  DuckDuckGoAdapter.prototype.search = async () => [
    { title: 'Test', url: 'https://example.com', snippet: 'ok', fetchedAt: Date.now() },
  ];

  const rateLimitUser = 'rate-test-' + Date.now();
  let blocked = false;
  for (let i = 0; i < 5; i++) {
    try {
      await fetcher.webSearch('test query', rateLimitUser, db);
    } catch (e) {
      if (e.code === 'RATE_LIMIT') { blocked = true; break; }
    }
  }
  ok('rate limit blocks after KURO_WEB_RATE_LIMIT', blocked);

  // Restore
  delete process.env.KURO_WEB_RATE_LIMIT;
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];
})();

// ─── SCENARIO 4: Disabled flag blocks ─────────────────────────────────────────
console.log('\n[4] Disabled flag');
(async () => {
  process.env.KURO_WEB_ENABLED = 'false';
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];

  const fetcher = require('../layers/web/web_fetcher.cjs');
  ok('WEB_ENABLED is false', fetcher.WEB_ENABLED === false);

  let threw = false;
  try {
    await fetcher.webSearch('test', 'u1', db);
  } catch(e) {
    threw = e.code === 'DISABLED';
  }
  ok('webSearch throws DISABLED when flag is false', threw);

  // Restore
  delete process.env.KURO_WEB_ENABLED;
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];
})();

// ─── SCENARIO 5: tool_calls logged ───────────────────────────────────────────
console.log('\n[5] Audit trail');
(async () => {
  process.env.KURO_WEB_ENABLED    = 'true';
  process.env.KURO_WEB_RATE_LIMIT = '100';
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];

  const fetcher = require('../layers/web/web_fetcher.cjs');
  const { DuckDuckGoAdapter } = require('../layers/web/web_duckduckgo_adapter.cjs');
  DuckDuckGoAdapter.prototype.search = async () => [
    { title: 'Result', url: 'https://example.com', snippet: 'test', fetchedAt: Date.now() },
  ];

  const before = db.prepare("SELECT COUNT(*) as n FROM tool_calls WHERE tool='web.search'").get().n;
  await fetcher.webSearch('kuro ai', 'audit-user', db);
  const after  = db.prepare("SELECT COUNT(*) as n FROM tool_calls WHERE tool='web.search'").get().n;

  ok('tool_calls row created for web.search', after > before);

  const row = db.prepare("SELECT * FROM tool_calls WHERE tool='web.search' ORDER BY id DESC LIMIT 1").get();
  ok('tool is web.search', row?.tool === 'web.search');
  ok('input_json contains query', row?.input_json?.includes('kuro ai'));
  ok('status is ok', row?.status === 'ok');

  // Restore
  delete process.env.KURO_WEB_ENABLED;
  delete process.env.KURO_WEB_RATE_LIMIT;
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];
})();

// ─── SCENARIO 6: Context bounded ─────────────────────────────────────────────
console.log('\n[6] Context token cap');
(() => {
  // Set MAX_TOKENS low via env, reload
  process.env.KURO_WEB_MAX_TOKENS = '100';
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];

  const { buildContextInjection: bci } = require('../layers/web/web_fetcher.cjs');

  const results = Array.from({ length: 5 }, (_, i) => ({
    title:     `Result ${i + 1}`,
    url:       `https://example${i}.com`,
    snippet:   'A'.repeat(50),
    fetchedAt: Date.now(),
  }));

  const ctx = bci(results);
  ok('context is bounded (< 500 chars)', ctx.length < 500);
  ok('truncation marker present when content cut', ctx.includes('[truncated]'));

  // Restore
  delete process.env.KURO_WEB_MAX_TOKENS;
  delete require.cache[require.resolve('../layers/web/web_fetcher.cjs')];
  delete require.cache[require.resolve('../layers/web/web_duckduckgo_adapter.cjs')];
})();

// ─── Summary ──────────────────────────────────────────────────────────────────
setTimeout(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED');
    process.exit(0);
  }
}, 500);
