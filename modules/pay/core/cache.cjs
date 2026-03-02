'use strict';

/**
 * KURO::PAY simple TTL in-memory cache.
 * Auto-expires entries via setTimeout.
 */

const store = new Map();   // key -> { value, timer }

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  return entry.value;
}

function set(key, value, ttlMs) {
  del(key);                               // clear previous if exists
  const timer = setTimeout(() => {
    store.delete(key);
  }, ttlMs);
  if (timer.unref) timer.unref();         // don't keep process alive
  store.set(key, { value, timer });
}

function del(key) {
  const entry = store.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    store.delete(key);
  }
}

function clear() {
  for (const [, entry] of store) {
    clearTimeout(entry.timer);
  }
  store.clear();
}

module.exports = { get, set, del, clear };
