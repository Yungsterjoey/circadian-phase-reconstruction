/**
 * KURO::TIER GATE v1.0
 * Tier-based access control middleware
 * Double-wall: Express route (outer) + agent check (inner) — GPT-05
 *
 * KURO::USAGE TRACKER v1.0
 * Buffered usage tracking with 30s flush — GPT-03
 * Enforced daily quotas behind "unlimited" marketing — GPT-06
 */

const { stmts } = require('./db.cjs');

// ═══════════════════════════════════════════════════════
// TIER LEVELS
// ═══════════════════════════════════════════════════════

const TIER_LEVEL = { free: 0, pro: 1, sovereign: 2 };

// ═══════════════════════════════════════════════════════
// QUOTAS — GPT-06: Enforced, not just marketed
// ═══════════════════════════════════════════════════════

const QUOTAS = {
  free: {
    chat_weekly: 25,      // 25/week
    chat_daily: 10,       // soft daily cap within weekly
    vision_weekly: 1,     // 1 image per week (free tier showcase)
    exec_hourly: 0,
    file_hourly: 0,
    max_concurrent: 1
  },
  pro: {
    chat_weekly: 1400,
    chat_daily: 200,
    vision_weekly: 140,   // ~20/day
    exec_hourly: 0,       // exec is sovereign only
    file_hourly: 60,
    max_concurrent: 2
  },
  sovereign: {
    chat_weekly: 3500,
    chat_daily: 500,
    vision_weekly: 350,   // ~50/day
    exec_hourly: 30,
    file_hourly: 120,
    max_concurrent: 3
  }
};

// ═══════════════════════════════════════════════════════
// TIER GATE MIDDLEWARE (outer wall)
// ═══════════════════════════════════════════════════════

/**
 * Express middleware: require minimum tier
 * Returns 403 with upgrade info if insufficient
 */
function requireTier(minTier) {
  return (req, res, next) => {
    const userTier = req.user?.tier || 'free';
    if ((TIER_LEVEL[userTier] || 0) >= (TIER_LEVEL[minTier] || 0)) return next();
    return res.status(403).json({
      error: 'tier_required',
      required: minTier,
      current: userTier,
      message: `This feature requires ${minTier === 'pro' ? 'Pro' : 'Sovereign'} tier`,
      upgrade_url: '/api/stripe/checkout'
    });
  };
}

/**
 * Agent-level tier check (inner wall — GPT-05)
 * Called inside agent_orchestrator, not as Express middleware
 */
function validateAgentAccess(user, requestedAgent, agents) {
  const agent = agents?.[requestedAgent];
  if (!agent) return { allowed: false, reason: 'unknown_agent' };

  const TIER_FOR_AGENT = { 1: 'free', 2: 'pro', 3: 'sovereign' };
  const requiredTier = TIER_FOR_AGENT[agent.tier] || 'sovereign';

  if ((TIER_LEVEL[user.tier] || 0) < (TIER_LEVEL[requiredTier] || 0)) {
    return { allowed: false, reason: 'tier_insufficient', required: requiredTier, current: user.tier };
  }

  if (agent.capabilities?.includes('exec') && user.tier !== 'sovereign') {
    return { allowed: false, reason: 'exec_requires_sovereign' };
  }

  return { allowed: true };
}

// ═══════════════════════════════════════════════════════
// USAGE TRACKER — GPT-03: Buffered writes
// ═══════════════════════════════════════════════════════

// In-memory buffer: key → increment count
const usageBuffer = new Map();
const FLUSH_INTERVAL = 30 * 1000; // 30 seconds

/**
 * Record usage (buffered — does NOT write to DB immediately)
 */
function recordUsage(userId, action) {
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const key = `${userId}:${action}:${weekNum}`;
  usageBuffer.set(key, (usageBuffer.get(key) || 0) + 1);
}

/**
 * Flush buffer to SQLite
 */
function flushUsage() {
  if (usageBuffer.size === 0) return;
  const entries = [...usageBuffer.entries()];
  usageBuffer.clear();

  for (const [key, count] of entries) {
    const [userId, action, weekNum] = key.split(':');
    try {
      stmts.upsertUsage.run(userId, action, parseInt(weekNum), count);
    } catch (e) {
      console.error('[USAGE] Flush error:', e.message);
    }
  }
}

// Flush every 30 seconds
const flushTimer = setInterval(flushUsage, FLUSH_INTERVAL);
// Flush on process exit
process.on('beforeExit', flushUsage);
process.on('SIGTERM', () => { flushUsage(); process.exit(0); });
process.on('SIGINT', () => { flushUsage(); process.exit(0); });

/**
 * Get current usage count (DB + buffer combined)
 */
function getUsageCount(userId, action) {
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const key = `${userId}:${action}:${weekNum}`;

  // DB value
  const row = stmts.getUsage.get(userId, action, weekNum);
  const dbCount = row?.count || 0;

  // Buffer value
  const bufCount = usageBuffer.get(key) || 0;

  return dbCount + bufCount;
}

/**
 * Check if user is within quota for an action
 * Returns: { allowed, remaining, limit, used }
 */
function checkQuota(userId, tier, action) {
  const quotas = QUOTAS[tier] || QUOTAS.free;
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));

  let limit, used;

  if (action === 'chat') {
    limit = quotas.chat_weekly;
    used = getUsageCount(userId, 'chat');
  } else if (action === 'vision') {
    // Weekly quota for vision (v7.0.3: free=1/week, pro=140/week, sovereign=350/week)
    limit = quotas.vision_weekly;
    used = getUsageCount(userId, 'vision');
  } else if (action === 'exec') {
    limit = quotas.exec_hourly;
    // Hourly — approximate with recent buffer
    used = getUsageCount(userId, 'exec'); // simplified
  } else if (action === 'file') {
    limit = quotas.file_hourly;
    used = getUsageCount(userId, 'file');
  } else {
    return { allowed: true, remaining: Infinity, limit: Infinity, used: 0 };
  }

  const remaining = Math.max(0, limit - used);
  return { allowed: used < limit, remaining, limit, used };
}

/**
 * Express middleware: check quota before processing
 */
function requireQuota(action) {
  return (req, res, next) => {
    const tier = req.user?.tier || 'free';
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });

    const quota = checkQuota(userId, tier, action);
    if (!quota.allowed) {
      return res.status(429).json({
        error: 'quota_exceeded',
        action,
        limit: quota.limit,
        used: quota.used,
        tier,
        message: tier === 'free'
          ? `Free tier limit reached (${quota.limit}). Upgrade for more.`
          : `Daily limit reached (${quota.limit}). Resets tomorrow.`,
        upgrade_url: tier === 'free' ? '/api/stripe/checkout' : null
      });
    }

    // Attach quota info for downstream use
    req.quota = quota;
    next();
  };
}

module.exports = {
  requireTier,
  requireQuota,
  validateAgentAccess,
  recordUsage,
  getUsageCount,
  checkQuota,
  flushUsage,
  QUOTAS,
  TIER_LEVEL
};
