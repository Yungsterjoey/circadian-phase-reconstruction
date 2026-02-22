/**
 * KURO::AUTH Middleware v2.0
 * Session cookie → X-KURO-Token → tokens.json (waterfall)
 *
 * Backwards compatible: existing tokens continue working.
 * New sessions use httpOnly cookie (kuro_sid).
 *
 * req.user shape is compatible with v1.0 auth_middleware.js:
 *   { userId, name, role, tier, devAllowed, skills, maxAgentTier, level, ... }
 */

const crypto = require('crypto');
const { stmts, logAuthEvent } = require('./db.cjs');

// Session lifetime policy (env-configurable for enterprise hardening)
const SESSION_MAX_DAYS = parseInt(process.env.KURO_SESSION_MAX_DAYS || '7', 10);
const SESSION_INACTIVITY_HOURS = process.env.KURO_SESSION_INACTIVITY_HOURS
  ? parseInt(process.env.KURO_SESSION_INACTIVITY_HOURS, 10) : null;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // mirrors SESSION_DURATION in auth_routes.cjs

// Tier → role mapping (bridges new tier system to existing role system)
const TIER_MAP = {
  free: {
    role: 'viewer', level: 1, devAllowed: false,
    skills: ['read', 'compute'],
    canAdmin: false, canSealAudit: false, canClearRAG: false,
    maxAgentTier: 1
  },
  pro: {
    role: 'analyst', level: 2, devAllowed: false,
    skills: ['read', 'compute', 'aggregate'],
    canAdmin: false, canSealAudit: false, canClearRAG: false,
    maxAgentTier: 2
  },
  sovereign: {
    role: 'operator', level: 3, devAllowed: true,
    skills: ['read', 'write', 'exec', 'compute', 'aggregate'],
    canAdmin: true, canSealAudit: true, canClearRAG: true,
    maxAgentTier: 3
  }
};

// Legacy resolveUser reference (set during init)
let legacyResolveUser = null;

/**
 * Initialize with legacy auth module for fallback
 */
function initLegacyFallback(legacyModule) {
  if (legacyModule && typeof legacyModule.resolveUser === 'function') {
    legacyResolveUser = legacyModule.resolveUser;
    console.log('[AUTH:V2] Legacy token fallback enabled');
  }
}

/**
 * Build req.user object from DB session row
 * Compatible with existing middleware shape
 */
function sessionToUser(session) {
  const tier = session.tier || 'free';
  const map = TIER_MAP[tier] || TIER_MAP.free;

  return {
    userId: session.user_id,
    name: session.name || 'User',
    email: session.email,
    role: map.role,
    tier,
    profile: session.profile || 'enterprise',
    devAllowed: map.devAllowed,
    skills: map.skills,
    canAdmin: map.canAdmin,
    canSealAudit: map.canSealAudit,
    canClearRAG: map.canClearRAG,
    maxAgentTier: map.maxAgentTier,
    level: map.level,
    emailVerified: !!session.email_verified,
    sessionId: session.id,
    authMethod: 'session'
  };
}

/**
 * Resolve user from request — waterfall:
 * 1. Session cookie (kuro_sid)
 * 2. Legacy token (X-KURO-Token / Bearer / query)
 */
function resolveUserV2(req) {
  // 1. Check session cookie
  const sid = req.cookies?.kuro_sid;
  if (sid) {
    const session = stmts.getSession.get(sid);
    if (session) {
      const now = Date.now();
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
      const ua = (req.headers['user-agent'] || '').slice(0, 256);

      // Absolute max lifetime guard (KURO_SESSION_MAX_DAYS, default 7)
      const createdAt = new Date(session.created_at).getTime();
      if (!isNaN(createdAt) && now - createdAt > SESSION_MAX_DAYS * 86400 * 1000) {
        try { stmts.deleteSession.run(sid); } catch(e) {}
        logAuthEvent(session.user_id, 'session_expired', ip, ua, { reason: 'max_lifetime' });
        return null;
      }

      // Inactivity timeout guard (KURO_SESSION_INACTIVITY_HOURS — optional)
      if (SESSION_INACTIVITY_HOURS && session.expires_at) {
        const expiresAt = new Date(session.expires_at).getTime();
        const lastActive = expiresAt - SESSION_DURATION_MS;
        if (!isNaN(lastActive) && now - lastActive > SESSION_INACTIVITY_HOURS * 3600 * 1000) {
          try { stmts.deleteSession.run(sid); } catch(e) {}
          logAuthEvent(session.user_id, 'session_expired', ip, ua, { reason: 'inactivity' });
          return null;
        }
      }

      // Sliding window: refresh session expiry on each authenticated request
      try { stmts.refreshSession.run(sid); } catch(e) {}
      return sessionToUser(session);
    }
    // Cookie exists but session expired/invalid — clear it
    // (handled in middleware response)
  }

  // 2. Fallback to legacy token system (disabled when KURO_JSON_TOOLS_ONLY=true)
  const toolsOnly = (process.env.KURO_JSON_TOOLS_ONLY ?? 'false').toLowerCase() === 'true';
  if (!toolsOnly && legacyResolveUser) {
    const legacyUser = legacyResolveUser(req);
    if (legacyUser) {
      legacyUser.authMethod = 'legacy_token';
      return legacyUser;
    }
  }

  return null;
}

/**
 * Auth middleware factory (drop-in replacement)
 */
function authMiddlewareV2(opts = {}) {
  const { required = true, minLevel = 0, requireAdmin = false, requireDev = false } = opts;

  return function (req, res, next) {
    const user = resolveUserV2(req);

    if (!user) {
      if (!required) {
        req.user = {
          userId: 'anon', name: 'Anonymous', role: 'viewer',
          tier: 'free', level: 0, devAllowed: false,
          skills: ['compute'], canAdmin: false, authMethod: 'none'
        };
        return next();
      }
      return res.status(401).json({
        error: 'Authentication required',
        hint: 'Sign in at kuroglass.net or provide X-KURO-Token header'
      });
    }

    if (user.level < minLevel) {
      return res.status(403).json({ error: 'Insufficient permissions', required: minLevel, actual: user.level });
    }
    if (requireAdmin && !user.canAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (requireDev && !user.devAllowed) {
      return res.status(403).json({ error: 'Dev access required' });
    }

    req.user = user;
    next();
  };
}

// Pre-built middleware — same names as v1 for drop-in replacement
const authV2 = {
  required: authMiddlewareV2({ required: true }),
  optional: authMiddlewareV2({ required: false }),
  operator: authMiddlewareV2({ required: true, minLevel: 3 }),
  analyst: authMiddlewareV2({ required: true, minLevel: 2 }),
  dev: authMiddlewareV2({ required: true, requireDev: true }),
  admin: authMiddlewareV2({ required: true, requireAdmin: true })
};

/**
 * Fingerprint (unchanged from v1)
 */
function fingerprint(req) {
  const raw = [
    req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '',
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || ''
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

module.exports = {
  resolveUser: resolveUserV2,
  authMiddleware: authMiddlewareV2,
  auth: authV2,
  fingerprint,
  initLegacyFallback,
  sessionToUser,
  TIER_MAP
};
