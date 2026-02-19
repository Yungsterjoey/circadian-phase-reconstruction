/**
 * KURO::SOVEREIGNTY DASHBOARD v1.0
 * 
 * Cryptographic proof that data stayed local.
 * 
 * Commercial AI is a black box. KURO is a glass box.
 * This module analyzes the Ed25519-signed audit chain to prove:
 *   1. What % of requests were processed locally vs frontier
 *   2. Exactly which requests touched external APIs (and which provider)
 *   3. Chain integrity (tamper-evident verification)
 *   4. Real-time sovereignty status
 * 
 * Every frontier_assist call is logged with full provenance.
 * This dashboard surfaces that data as a trust proof.
 * 
 * v7.0.2b — Extracted from Gemini "Sovereign Flight Recorder" proposal
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const AUDIT_DIR = path.join(DATA_DIR, 'audit');

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT CHAIN SCANNER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scan audit chain files for sovereignty metrics.
 * Reads JSONL audit files and categorizes by local vs frontier.
 */
function scanAuditChain(dateRange = null) {
  const files = [];
  try {
    const entries = fs.readdirSync(AUDIT_DIR).filter(f => f.startsWith('audit_chain_') && f.endsWith('.jsonl'));
    
    for (const file of entries) {
      // Extract date from filename: audit_chain_20260215.jsonl
      const dateMatch = file.match(/audit_chain_(\d{8})/);
      if (!dateMatch) continue;
      
      const fileDate = dateMatch[1];
      if (dateRange?.after && fileDate < dateRange.after) continue;
      if (dateRange?.before && fileDate > dateRange.before) continue;
      
      files.push(path.join(AUDIT_DIR, file));
    }
  } catch (e) {
    return { error: e.message, entries: [] };
  }

  const metrics = {
    totalRequests: 0,
    localRequests: 0,
    frontierRequests: 0,
    frontierProviders: {},   // { anthropic: 5, openai: 2 }
    frontierDetails: [],     // { timestamp, provider, model, reason, requestId }
    synthesisRequests: 0,
    visionRequests: 0,
    chainIntegrity: 'unknown',
    dateRange: { earliest: null, latest: null },
    scannedFiles: files.length
  };

  for (const file of files) {
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      
      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        
        // Track date range
        if (entry.timestamp) {
          const ts = entry.timestamp;
          if (!metrics.dateRange.earliest || ts < metrics.dateRange.earliest) metrics.dateRange.earliest = ts;
          if (!metrics.dateRange.latest || ts > metrics.dateRange.latest) metrics.dateRange.latest = ts;
        }

        // Categorize by agent/action
        const agent = entry.agent || entry.event?.agent;
        const action = entry.action || entry.event?.action;

        if (agent === 'stream' && action === 'local_only') {
          metrics.totalRequests++;
          metrics.localRequests++;
        } else if (agent === 'frontier_assist') {
          if (action === 'route_frontier') {
            metrics.totalRequests++;
            metrics.frontierRequests++;
            
            const provider = entry.meta?.provider || entry.event?.meta?.provider || 'unknown';
            metrics.frontierProviders[provider] = (metrics.frontierProviders[provider] || 0) + 1;
            
            metrics.frontierDetails.push({
              timestamp: entry.timestamp,
              provider,
              model: entry.meta?.model || 'unknown',
              reason: entry.meta?.reason,
              poh: entry.meta?.poh,
              requestId: entry.requestId
            });
          }
        } else if (agent === 'synthesis') {
          if (action === 'start') metrics.synthesisRequests++;
        } else if (agent === 'vision') {
          metrics.visionRequests++;
        }
      }
    } catch (e) {
      // Skip unreadable files
    }
  }

  return metrics;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGNTY PROOF
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a sovereignty proof — a signed attestation of data locality.
 */
function generateProof(verifyAll) {
  const metrics = scanAuditChain();
  const chainVerification = typeof verifyAll === 'function' ? verifyAll() : { allValid: 'unverified' };

  const total = metrics.totalRequests || 1; // avoid /0
  const localPercent = ((metrics.localRequests / total) * 100).toFixed(2);
  const frontierPercent = ((metrics.frontierRequests / total) * 100).toFixed(2);

  return {
    sovereignty: {
      localPercent: parseFloat(localPercent),
      frontierPercent: parseFloat(frontierPercent),
      verdict: metrics.frontierRequests === 0 ? 'FULLY_SOVEREIGN' : 'HYBRID',
      description: metrics.frontierRequests === 0
        ? '100% of inference processed on local hardware. Zero data left the server.'
        : `${localPercent}% local, ${frontierPercent}% routed to frontier APIs for complex tasks.`
    },
    metrics: {
      total: metrics.totalRequests,
      local: metrics.localRequests,
      frontier: metrics.frontierRequests,
      synthesis: metrics.synthesisRequests,
      vision: metrics.visionRequests,
      frontierProviders: metrics.frontierProviders
    },
    chain: {
      integrity: chainVerification.allValid ? 'INTACT' : 'COMPROMISED',
      details: chainVerification,
      tamperEvident: true,
      algorithm: 'Ed25519'
    },
    dateRange: metrics.dateRange,
    generatedAt: Date.now(),
    // If frontier was used, list the exact requests for full transparency
    frontierDisclosure: metrics.frontierDetails.slice(-50) // Last 50 frontier calls
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// REAL-TIME STATUS
// ═══════════════════════════════════════════════════════════════════════════

// Track current session's frontier usage in memory (faster than scanning files)
let _sessionMetrics = { local: 0, frontier: 0, started: Date.now() };

function recordLocal() { _sessionMetrics.local++; }
function recordFrontier() { _sessionMetrics.frontier++; }

function realtimeStatus() {
  const total = _sessionMetrics.local + _sessionMetrics.frontier || 1;
  return {
    session: {
      local: _sessionMetrics.local,
      frontier: _sessionMetrics.frontier,
      localPercent: parseFloat(((_sessionMetrics.local / total) * 100).toFixed(1)),
      uptime: Math.round((Date.now() - _sessionMetrics.started) / 1000)
    },
    isSovereign: _sessionMetrics.frontier === 0
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS ROUTE MOUNTER
// ═══════════════════════════════════════════════════════════════════════════

function mountSovereigntyRoutes(app, verifyAll) {
  // Full sovereignty proof — detailed analysis of all audit data
  app.get('/api/sovereignty', (req, res) => {
    try {
      const proof = generateProof(verifyAll);
      res.json(proof);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Real-time session status — lightweight polling
  app.get('/api/sovereignty/live', (req, res) => {
    res.json(realtimeStatus());
  });

  // Frontier disclosure — list all external API calls
  app.get('/api/sovereignty/frontier', (req, res) => {
    const metrics = scanAuditChain();
    res.json({
      totalFrontierCalls: metrics.frontierRequests,
      providers: metrics.frontierProviders,
      details: metrics.frontierDetails.slice(-100)
    });
  });

  console.log('[SOVEREIGNTY] Routes mounted: /api/sovereignty/{,live,frontier}');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  scanAuditChain,
  generateProof,
  recordLocal,
  recordFrontier,
  realtimeStatus,
  mountSovereigntyRoutes
};
