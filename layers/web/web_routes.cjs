/**
 * KURO Web Routes — POST /api/web/search
 *
 * Requires authentication.
 * Respects KURO_WEB_ENABLED flag (503 if disabled).
 * Returns: { results: [{ title, url, snippet, fetchedAt }] }
 */

'use strict';

const { webSearch, WEB_ENABLED } = require('./web_fetcher.cjs');

/**
 * @param {object} auth    — auth middleware (auth.required)
 * @param {{ db: object }} opts
 * @returns Express Router
 */
function mountWebRoutes(auth, { db }) {
  const express = require('express');
  const router  = express.Router();

  router.post('/search', auth.required, async (req, res) => {
    if (!WEB_ENABLED) {
      return res.status(503).json({ error: 'Web search disabled (KURO_WEB_ENABLED=false)' });
    }

    const { query } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    try {
      const { results, context, truncated } = await webSearch(query.trim(), req.user.userId, db);
      res.json({ results, context, truncated });
    } catch (e) {
      if (e.code === 'RATE_LIMIT') return res.status(429).json({ error: e.message });
      if (e.code === 'DISABLED')   return res.status(503).json({ error: e.message });
      res.status(502).json({ error: `Web search failed: ${e.message}` });
    }
  });

  return router;
}

module.exports = mountWebRoutes;
