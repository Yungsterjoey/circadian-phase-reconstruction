'use strict';

// Adapter registry — adapters register themselves on require().
// Key: adapter.id (string). Value: adapter object satisfying _interface.cjs contract.

const _registry = new Map();

function register(adapter) {
  if (!adapter || !adapter.id) throw new Error('Adapter must have an id');
  _registry.set(adapter.id, adapter);
}

function get(id) {
  return _registry.get(id) || null;
}

function list() {
  return [..._registry.values()];
}

function has(id) {
  return _registry.has(id);
}

module.exports = { register, get, list, has };
