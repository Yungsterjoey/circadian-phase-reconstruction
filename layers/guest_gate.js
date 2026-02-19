/**
 * KURO::GUEST GATE v1.0
 * IP-fingerprint-based demo limiter
 * 5 messages per 24 hours for unauthenticated visitors
 * Server-side enforcement — no client trust
 */

const crypto = require('crypto');

const DEMO_LIMIT = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL = 60 * 60 * 1000; // hourly cleanup

// In-memory store: fingerprint → { count, firstSeen, lastSeen }
const demoUsage = new Map();

/**
 * Generate fingerprint from request
 * Combines IP + user-agent + accept-language for moderate uniqueness
 */
function guestFingerprint(req) {
  const raw = [
    req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '',
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || ''
  ].join('|');
  return 'guest_' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Check if guest can send a message
 * Returns { allowed: bool, remaining: int, resetIn: ms, fingerprint: string }
 */
function checkGuestQuota(req) {
  const fp = guestFingerprint(req);
  const now = Date.now();

  let entry = demoUsage.get(fp);
  if (!entry || (now - entry.firstSeen) > WINDOW_MS) {
    // New window
    entry = { count: 0, firstSeen: now, lastSeen: now };
    demoUsage.set(fp, entry);
  }

  const remaining = Math.max(0, DEMO_LIMIT - entry.count);
  const resetIn = WINDOW_MS - (now - entry.firstSeen);

  return {
    allowed: entry.count < DEMO_LIMIT,
    remaining,
    used: entry.count,
    limit: DEMO_LIMIT,
    resetIn,
    fingerprint: fp
  };
}

/**
 * Consume one demo message
 */
function consumeGuestMessage(req) {
  const fp = guestFingerprint(req);
  const entry = demoUsage.get(fp);
  if (entry) {
    entry.count++;
    entry.lastSeen = Date.now();
  }
}

/**
 * Guest user object (minimal permissions)
 */
function guestUser(fp) {
  return {
    userId: fp,
    name: 'Demo User',
    role: 'guest',
    devAllowed: false,
    skills: ['compute'],
    canAdmin: false,
    canSealAudit: false,
    canClearRAG: false,
    maxAgentTier: 1,
    level: 0,
    isGuest: true
  };
}

/**
 * Express middleware: allows guest access to specific endpoints
 * If token present → normal auth. If no token → guest with quota.
 */
function guestOrAuth(resolveUser) {
  return function(req, res, next) {
    // Try token auth first
    const user = resolveUser(req);
    if (user) {
      req.user = user;
      req.isGuest = false;
      return next();
    }

    // No token — guest access
    const quota = checkGuestQuota(req);
    req.user = guestUser(quota.fingerprint);
    req.isGuest = true;
    req.guestQuota = quota;
    next();
  };
}

// Cleanup stale entries hourly
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [fp, entry] of demoUsage) {
    if ((now - entry.firstSeen) > WINDOW_MS) {
      demoUsage.delete(fp);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[GUEST] Cleaned ${cleaned} expired demo sessions`);
}, CLEANUP_INTERVAL);

/**
 * Stats for health/admin
 */
function guestStats() {
  return {
    activeGuests: demoUsage.size,
    demoLimit: DEMO_LIMIT,
    windowHours: WINDOW_MS / 3600000
  };
}

module.exports = { checkGuestQuota, consumeGuestMessage, guestUser, guestOrAuth, guestFingerprint, guestStats, DEMO_LIMIT };
