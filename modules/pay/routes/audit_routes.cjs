'use strict';

const express = require('express');
const router = express.Router();

const ledger = require('../core/ledger.cjs');
const audit = require('../core/audit.cjs');

/* ------------------------------------------------------------------ */
/*  GET /audit?limit=20&offset=0 — Paginated audit records             */
/* ------------------------------------------------------------------ */

router.get('/', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const rows = ledger.getAuditPage(limit, offset);

    return res.json({
      ok: true,
      data: rows,
      pagination: { limit, offset, count: rows.length },
    });
  } catch (err) {
    console.error('[PAY::Audit] list error:', err.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /audit/verify — Verify hash chain integrity                    */
/* ------------------------------------------------------------------ */

router.get('/verify', (req, res) => {
  try {
    const result = audit.verifyChain();

    return res.json({
      ok: true,
      valid: result.valid,
      total: result.total,
      broken_at: result.broken_at,
    });
  } catch (err) {
    console.error('[PAY::Audit] verify error:', err.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

module.exports = router;
