#!/usr/bin/env node
'use strict';

const http = require('http');
const { URL } = require('url');

const base = process.argv[2] || 'http://127.0.0.1:3100';
const u = new URL('/api/stream', base);
const payload = JSON.stringify({
  messages: [{ role: 'user', content: 'hello' }],
  agent: 'insights',
  skill: 'chat',
  temperature: 0.7,
  thinking: false,
  sessionId: `smoke-${Date.now()}`,
  powerDial: 'instant',
});

const start = Date.now();
let firstByteMs = null;
let body = '';

const headers = {
  'Content-Type': 'application/json',
  'Content-Length': Buffer.byteLength(payload),
};
if (process.env.KURO_TOKEN) headers['X-KURO-Token'] = process.env.KURO_TOKEN;
if (process.env.KURO_COOKIE) headers['Cookie'] = process.env.KURO_COOKIE;

const req = http.request(u, { method: 'POST', headers }, (res) => {
  if (res.statusCode < 200 || res.statusCode >= 300) {
    console.error(`FAIL: HTTP ${res.statusCode}`);
    process.exit(2);
  }

  res.on('data', (chunk) => {
    if (firstByteMs != null) return; // already passed
    const text = chunk.toString('utf8');
    body += text;
    if (text.includes('data: ')) {
      firstByteMs = Date.now() - start;
      if (firstByteMs > 2000) {
        console.error(`FAIL: first SSE frame in ${firstByteMs}ms (>2000ms)`);
        req.destroy();
        process.exit(4);
      }
      console.log(`PASS: first SSE frame ${firstByteMs}ms`);
      req.destroy();
      process.exit(0);
    }
  });

  res.on('end', () => {
    if (firstByteMs == null) {
      console.error('FAIL: no SSE data frames received');
      process.exit(3);
    }
  });
});

req.setTimeout(5000, () => {
  req.destroy(new Error('timeout waiting for first SSE frame'));
});
req.on('error', (err) => {
  if (err.message && !err.message.includes('socket hang up') && err.code !== 'ECONNRESET') {
    console.error(`FAIL: ${err.message}`);
    process.exit(1);
  }
});
req.write(payload);
req.end();
