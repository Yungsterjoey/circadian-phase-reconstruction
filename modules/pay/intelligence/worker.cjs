'use strict';
// §5.2 — async intelligence worker. Single process, pull-based. No Redis.
const iq = require('../core/intelligence_queue.cjs');

const HANDLERS = new Map();
const POLL_MS = 1_000;
let _timer = null;
let _running = false;

function register(taskType, handler) {
  HANDLERS.set(taskType, handler);
}

async function processOne() {
  if (_running) return false;
  const task = iq.claimNext();
  if (!task) return false;
  _running = true;
  try {
    const handler = HANDLERS.get(task.task_type);
    if (!handler) {
      iq.fail(task.id, `no handler for ${task.task_type}`);
      return true;
    }
    await handler(task.payload, { id: task.id, attempts: task.attempts });
    iq.complete(task.id);
  } catch (err) {
    iq.fail(task.id, err && err.message ? err.message : String(err));
  } finally {
    _running = false;
  }
  return true;
}

async function drain() {
  // Pull until queue is empty or only retry-pending tasks remain.
  // Each pass processes currently-pending tasks once. Callers invoke
  // drain() multiple times to exercise the full retry cycle.
  while (await processOne()) { /* loop */ }
}

function start() {
  if (_timer) return;
  _timer = setInterval(() => { processOne().catch(() => {}); }, POLL_MS);
  if (_timer.unref) _timer.unref();
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { register, start, stop, drain, processOne, _handlers: HANDLERS };
