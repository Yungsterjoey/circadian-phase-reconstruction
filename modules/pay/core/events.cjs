'use strict';

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

/**
 * KURO::PAY internal event bus.
 * Thin wrapper around a singleton EventEmitter.
 */

function emit(type, payload) {
  bus.emit(type, payload);
}

function on(type, handler) {
  bus.on(type, handler);
}

function off(type, handler) {
  bus.off(type, handler);
}

module.exports = { emit, on, off };
