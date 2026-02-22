/**
 * KURO Web Adapter Interface
 *
 * Abstract base for web search backends.
 * All adapters must implement search(query, options) → [Result].
 *
 * Result shape:
 *   { title: string, url: string, snippet: string, fetchedAt: number }
 */

'use strict';

class WebAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name  = 'WebAdapterError';
    this.code  = code;
  }
}

class WebAdapter {
  /**
   * @param {string} query
   * @param {{ maxResults: number, timeoutMs: number }} options
   * @returns {Promise<Array<{ title, url, snippet, fetchedAt }>>}
   */
  async search(query, options) { // eslint-disable-line no-unused-vars
    throw new Error('WebAdapter.search() not implemented');
  }
}

module.exports = { WebAdapter, WebAdapterError };
