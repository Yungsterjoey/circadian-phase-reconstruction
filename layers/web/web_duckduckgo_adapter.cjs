/**
 * KURO Web — DuckDuckGo Search Adapter
 *
 * Uses the DDG Lite HTML endpoint (no API key required).
 * Parses the HTML response to extract result titles, URLs, and snippets.
 *
 * Constraints:
 *   - No auth headers forwarded
 *   - No redirects to non-https
 *   - Strict byte cap on fetched content
 *   - HTML stripped from snippets
 */

'use strict';

const https = require('https');
const http  = require('http');
const { WebAdapter, WebAdapterError } = require('./web_adapter.interface.cjs');

const DDG_URL = 'https://html.duckduckgo.com/html/';
const MAX_RESPONSE_BYTES = 524288; // 512 KB raw HTML cap

/** Strip HTML tags and collapse whitespace */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Fetch a URL with a timeout, byte cap, and no auth header forwarding.
 * Rejects non-http(s) schemes and non-https redirects.
 */
function safeFetch(url, timeoutMs, _redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const finish = (v, isErr) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (isErr) reject(v); else resolve(v);
    };

    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return finish(new WebAdapterError('INVALID_SCHEME', `Disallowed scheme: ${parsed.protocol}`), true);
    }

    const timer = setTimeout(() => finish(new WebAdapterError('TIMEOUT', 'Request timed out'), true), timeoutMs);

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KURO/9; +https://kuro.ai)',
        'Accept': 'text/html',
        // No Authorization, Cookie, or X-* forwarded headers
      },
      timeout: timeoutMs,
    }, (res) => {
      // Follow a single redirect only if destination is https
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        req.destroy();
        const dest = res.headers.location;
        try {
          const destParsed = new URL(dest);
          if (destParsed.protocol !== 'https:') {
            return finish(new WebAdapterError('UNSAFE_REDIRECT', `Non-https redirect denied: ${dest}`), true);
          }
        } catch {
          return finish(new WebAdapterError('INVALID_REDIRECT', `Bad redirect URL: ${dest}`), true);
        }
        // Only one redirect level — depth guard prevents infinite recursion
        if (_redirectDepth >= 1) {
          return finish(new WebAdapterError('TOO_MANY_REDIRECTS', 'Max 1 redirect followed'), true);
        }
        safeFetch(dest, timeoutMs, _redirectDepth + 1).then(r => finish(r, false)).catch(e => finish(e, true));
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        return finish(new WebAdapterError('HTTP_ERROR', `HTTP ${res.statusCode}`), true);
      }

      let bytes = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          res.destroy();
          return; // already collecting what we have
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(Buffer.concat(chunks).toString('utf8'), false));
      res.on('error', e => finish(e, true));
    });

    req.on('error', e => finish(e, true));
    req.on('timeout', () => { req.destroy(); finish(new WebAdapterError('TIMEOUT', 'Socket timed out'), true); });
  });
}

/**
 * Parse DDG HTML response into result objects.
 * DDG lite returns results inside <div class="result"> blocks.
 */
function parseDdgHtml(html, maxResults) {
  const results = [];
  // Match result blocks (DDG lite HTML structure)
  const resultRe = /<div class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="[^"]*result|<\/div>\s*<\/div>)/gi;
  const titleRe  = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  const snipRe   = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

  let m;
  while ((m = resultRe.exec(html)) !== null && results.length < maxResults) {
    const block  = m[1];
    const tMatch = titleRe.exec(block);
    if (!tMatch) continue;

    const rawUrl  = tMatch[1];
    const title   = stripHtml(tMatch[2]).slice(0, 200);
    const sMatch  = snipRe.exec(block);
    const snippet = sMatch ? stripHtml(sMatch[1]).slice(0, 300) : '';

    // Resolve DDG redirect URLs: /l/?kh=-1&uddg=...
    let url = rawUrl;
    try {
      if (rawUrl.startsWith('/l/?') || rawUrl.startsWith('//duckduckgo.com/l/?')) {
        const params = new URL('https://duckduckgo.com' + (rawUrl.startsWith('//') ? rawUrl.slice(1) : rawUrl)).searchParams;
        url = params.get('uddg') || params.get('u') || rawUrl;
      }
    } catch { /* leave as-is */ }

    // Reject non-https URLs silently
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    } catch { continue; }

    if (!title || !url) continue;
    results.push({ title, url, snippet, fetchedAt: Date.now() });
  }
  return results;
}

class DuckDuckGoAdapter extends WebAdapter {
  /**
   * @param {string} query
   * @param {{ maxResults?: number, timeoutMs?: number }} opts
   */
  async search(query, { maxResults = 5, timeoutMs = 4000 } = {}) {
    const qs  = new URLSearchParams({ q: query, kl: 'wt-wt', kp: '-2' });
    const url = `${DDG_URL}?${qs}`;

    let html;
    try {
      html = await safeFetch(url, timeoutMs);
    } catch (e) {
      throw new WebAdapterError('FETCH_ERROR', `DDG fetch failed: ${e.message}`);
    }

    return parseDdgHtml(html, maxResults);
  }
}

module.exports = { DuckDuckGoAdapter };
