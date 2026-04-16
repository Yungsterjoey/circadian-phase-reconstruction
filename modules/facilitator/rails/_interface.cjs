'use strict';

// Rail adapter interface. Every rail module must export:
//   async settle(payload) → { success, transaction, network, payer, error? }
//   name()                → canonical scheme id
//   network()             → human-readable network name

module.exports = {};
