/**
 * KURO::WEB SEARCH v1.0
 * 
 * Web search sidecar with caching, citations, and audit chain logging.
 * Uses SearXNG (self-hosted) or DuckDuckGo API as backend.
 * 
 * Tier gating:
 *   Free: 5 searches/day, 3 results max
 *   Pro: 50 searches/day, 10 results max
 *   Sovereign: 200 searches/day, 10 results max + priority
 * 
 * Architecture:
 *   1. Query → sanitize → cache check
 *   2. If miss → SearXNG/DDG API → extract snippets
 *   3. Results → citation formatter → cache store
 *   4. Log to audit chain
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ═══ Configuration ═══
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888';
const SEARCH_CACHE_TTL = 30 * 60 * 1000; // 30 min
const MAX_SNIPPET_LENGTH = 500;

// ═══ Tier Quotas ═══
const SEARCH_QUOTAS = {
  free: { daily: 5, maxResults: 3 },
  pro: { daily: 50, maxResults: 10 },
  sovereign: { daily: 200, maxResults: 10 }
};

// ═══ Cache ═══
const searchCache = new Map();
const userQuotas = new Map(); // userId -> { count, date }

function getCacheKey(query, opts) {
  return crypto.createHash('sha256').update(`${query}|${opts?.maxResults || 5}`).digest('hex');
}

function getCached(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > SEARCH_CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  searchCache.set(key, { data, time: Date.now() });
  // Evict old entries
  if (searchCache.size > 500) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].time - b[1].time);
    for (let i = 0; i < 100; i++) searchCache.delete(oldest[i][0]);
  }
}

// ═══ Quota Check ═══
function checkSearchQuota(userId, tier) {
  const quota = SEARCH_QUOTAS[tier] || SEARCH_QUOTAS.free;
  const today = new Date().toISOString().slice(0, 10);
  
  let entry = userQuotas.get(userId);
  if (!entry || entry.date !== today) {
    entry = { count: 0, date: today };
    userQuotas.set(userId, entry);
  }
  
  if (entry.count >= quota.daily) {
    return { allowed: false, reason: 'daily_limit_reached', used: entry.count, limit: quota.daily };
  }
  
  return { allowed: true, remaining: quota.daily - entry.count, maxResults: quota.maxResults };
}

function consumeSearchQuota(userId) {
  const entry = userQuotas.get(userId);
  if (entry) entry.count++;
}

// ═══ SearXNG Query ═══
function querySearXNG(query, maxResults = 5) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SEARXNG_URL}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('engines', 'google,duckduckgo,brave');
    url.searchParams.set('safesearch', '1');
    
    const client = url.protocol === 'https:' ? https : http;
    
    const req = client.get(url, { timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const results = (data.results || []).slice(0, maxResults).map((r, i) => ({
            index: i,
            title: (r.title || '').slice(0, 200),
            url: r.url || '',
            snippet: (r.content || '').slice(0, MAX_SNIPPET_LENGTH),
            engine: r.engine || 'unknown',
            score: r.score || 0
          }));
          resolve(results);
        } catch(e) {
          reject(new Error(`SearXNG parse error: ${e.message}`));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('SearXNG timeout')); });
  });
}

// ═══ DuckDuckGo Fallback ═══
function queryDDG(query, maxResults = 5) {
  return new Promise((resolve, reject) => {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
    
    https.get(url, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const results = [];
          
          // Abstract
          if (data.Abstract) {
            results.push({
              index: 0,
              title: data.Heading || query,
              url: data.AbstractURL || '',
              snippet: data.Abstract.slice(0, MAX_SNIPPET_LENGTH),
              engine: 'duckduckgo',
              score: 1.0
            });
          }
          
          // Related topics
          for (const topic of (data.RelatedTopics || []).slice(0, maxResults - results.length)) {
            if (topic.Text) {
              results.push({
                index: results.length,
                title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 100),
                url: topic.FirstURL || '',
                snippet: topic.Text.slice(0, MAX_SNIPPET_LENGTH),
                engine: 'duckduckgo',
                score: 0.5
              });
            }
          }
          
          resolve(results);
        } catch(e) {
          reject(new Error(`DDG parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ═══ Main Search Function ═══
/**
 * @param {string} query - Search query
 * @param {string} userId - For quota tracking
 * @param {string} tier - User tier (free/pro/sovereign)
 * @param {object} opts - { maxResults }
 * @returns {object} { results, citations, cached, query }
 */
async function search(query, userId, tier, opts = {}) {
  // Quota check
  const quota = checkSearchQuota(userId, tier);
  if (!quota.allowed) {
    return { error: true, reason: quota.reason, used: quota.used, limit: quota.limit };
  }
  
  const maxResults = Math.min(opts.maxResults || 5, quota.maxResults);
  const cacheKey = getCacheKey(query, { maxResults });
  
  // Cache check
  const cached = getCached(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }
  
  // Query backends
  let results;
  try {
    results = await querySearXNG(query, maxResults);
  } catch(e) {
    // Fallback to DDG
    try {
      results = await queryDDG(query, maxResults);
    } catch(e2) {
      return { error: true, reason: 'search_unavailable', details: e.message };
    }
  }
  
  // Build citations
  const citations = results.map(r => `[${r.index + 1}] ${r.title} — ${r.url}`).join('\n');
  
  // Build context injection for model
  const contextBlock = results.map(r => 
    `[Source ${r.index + 1}: ${r.title}]\n${r.snippet}\nURL: ${r.url}`
  ).join('\n\n');
  
  const response = {
    query,
    results,
    citations,
    contextBlock,
    resultCount: results.length,
    cached: false,
    timestamp: Date.now()
  };
  
  // Cache + consume quota
  setCache(cacheKey, response);
  consumeSearchQuota(userId);
  
  return response;
}

/**
 * Format search results for injection into model context
 */
function formatForContext(searchResult) {
  if (!searchResult || searchResult.error) return '';
  return `\n[WEB SEARCH RESULTS for: "${searchResult.query}"]\n${searchResult.contextBlock}\n[END SEARCH RESULTS]\n`;
}

module.exports = {
  search,
  formatForContext,
  checkSearchQuota,
  SEARCH_QUOTAS
};
