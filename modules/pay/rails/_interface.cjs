'use strict';

// Rail adapter contract — documentation + runtime shape check.
//
// Required shape:
//   adapter.id                string    — unique rail identifier e.g. 'vietqr'
//   adapter.country           string    — ISO 3166-1 alpha-2 e.g. 'VN'
//   adapter.currency          string    — ISO 4217 alpha-3 e.g. 'VND'
//   adapter.identifierTypes   string[]  — e.g. ['emvco_qr', 'bank_account']
//   adapter.preferredConnector string   — connector id e.g. 'x402'
//   adapter.fallbackConnector  string   — connector id e.g. 'nium'
//
// Required methods:
//   detect(input)  → { matches: bool, confidence: 0-1, parsed?: object }
//   parse(input)   → { destination: object, displayName: string, metadata: object }
//   quote({ sourceAmount, sourceCurrency, destination })
//                  → { fxRate, fee, feeCapped, net, eta, ratesExact }
//   initiate({ stripePaymentIntentId, destination, userId })
//                  → { payoutId, status: 'pending'|'settled'|'failed' }
//   status(payoutId)
//                  → { status: 'pending'|'settled'|'failed', settledAt?, proof? }

const REQUIRED_FIELDS   = ['id', 'country', 'currency', 'identifierTypes', 'preferredConnector', 'fallbackConnector'];
const REQUIRED_METHODS  = ['detect', 'parse', 'quote', 'initiate', 'status'];

function validate(adapter) {
  for (const field of REQUIRED_FIELDS) {
    if (adapter[field] === undefined || adapter[field] === null) {
      throw new Error(`Rail adapter '${adapter.id || '?'}' missing required field: ${field}`);
    }
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new Error(`Rail adapter '${adapter.id || '?'}' missing required method: ${method}`);
    }
  }
  return true;
}

module.exports = { validate, REQUIRED_FIELDS, REQUIRED_METHODS };
