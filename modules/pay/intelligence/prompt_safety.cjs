'use strict';
// §8.1 — user input must be delimited; outputs scanned for echoed instructions.
const OPEN = '<user_input>';
const CLOSE = '</user_input>';

function wrap(s) {
  const scrubbed = String(s == null ? '' : s).replace(/<\/?user_input>/gi, '[removed-tag]');
  return `${OPEN}${scrubbed}${CLOSE}`;
}

const INJECTION_PATTERNS = [
  /^\s*system\s*[:>]/i,
  /ignore (previous|prior) (instructions|prompts)/i,
  /you are now (jailbroken|dan|evil)/i,
  /as an ai language model, (i cannot|i refuse)/i,
];

function isInjectionEcho(raw) {
  return INJECTION_PATTERNS.some(p => p.test(String(raw || '')));
}

module.exports = { wrap, isInjectionEcho };
