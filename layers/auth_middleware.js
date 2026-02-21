/**
 * KURO::AUTH v1.0
 * Token-based authentication with role-based access control
 * 
 * Token store: /etc/kuro/tokens.json (root-only, deployed by operator)
 * Fallback: /var/lib/kuro/tokens.json (for dev/lab profiles)
 *
 * Roles:
 *   operator  — full access (dev, exec, write, admin)
 *   analyst   — read, compute, aggregate (no exec, no write)
 *   viewer    — read-only, chat only
 *   service   — API access for integrations (scoped per token)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_PATHS = [
  process.env.KURO_TOKEN_FILE || '/etc/kuro/tokens.json',
  path.join(process.env.KURO_DATA || '/var/lib/kuro', 'tokens.json')
];

const ROLES = {
  operator: {
    level: 3,
    devAllowed: true,
    skills: ['read', 'write', 'exec', 'compute', 'aggregate'],
    canAdmin: true,
    canSealAudit: true,
    canClearRAG: true,
    maxAgentTier: 3  // all agents
  },
  analyst: {
    level: 2,
    devAllowed: false,
    skills: ['read', 'compute', 'aggregate'],
    canAdmin: false,
    canSealAudit: false,
    canClearRAG: false,
    maxAgentTier: 2  // insights + analysis
  },
  viewer: {
    level: 1,
    devAllowed: false,
    skills: ['read', 'compute'],
    canAdmin: false,
    canSealAudit: false,
    canClearRAG: false,
    maxAgentTier: 1  // insights only
  },
  service: {
    level: 1,
    devAllowed: false,
    skills: ['read', 'compute'],
    canAdmin: false,
    canSealAudit: false,
    canClearRAG: false,
    maxAgentTier: 1
  }
};

let tokenStore = {};
let tokenFilePath = null;

function loadTokens() {
  for (const tp of TOKEN_PATHS) {
    try {
      if (fs.existsSync(tp)) {
        tokenStore = JSON.parse(fs.readFileSync(tp, 'utf8'));
        tokenFilePath = tp;
        console.log(`[AUTH] Loaded ${Object.keys(tokenStore.tokens || {}).length} tokens from ${tp}`);
        return true;
      }
    } catch (e) { console.warn(`[AUTH] Failed to load ${tp}:`, e.message); }
  }
  console.warn('[AUTH] No token file found — all requests will be rejected');
  return false;
}

// Reload tokens on SIGHUP
process.on('SIGHUP', () => { loadTokens(); console.log('[AUTH] Tokens reloaded'); });

// Watch token file for changes
function watchTokenFile() {
  if (!tokenFilePath) return;
  try {
    fs.watchFile(tokenFilePath, { interval: 5000 }, () => {
      loadTokens();
      console.log('[AUTH] Tokens auto-reloaded');
    });
  } catch (e) {}
}

/**
 * Resolve user from request
 * Checks: Authorization header (Bearer), X-KURO-Token header, query param ?token=
 *
 * X-KURO-Token header auth is controlled by KURO_ENABLE_LEGACY_TOKEN env var.
 * Default is disabled (false). Set to 'true' to allow legacy header-based auth.
 */
function resolveUser(req) {
  const legacyEnabled = process.env.KURO_ENABLE_LEGACY_TOKEN === 'true';
  let token = null;

  // Bearer token (always honoured — feeds the kuro_tokens DB table path)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  // X-KURO-Token header — only when legacy auth is explicitly enabled
  if (!token) {
    if (req.headers['x-kuro-token']) {
      if (legacyEnabled) {
        token = req.headers['x-kuro-token'];
      } else {
        // Audit event: legacy header present but feature disabled
        console.error(`[SECURITY] ${new Date().toISOString()} LEGACY_TOKEN_HEADER_REJECTED`, JSON.stringify({
          ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown',
          path: req.path, method: req.method
        }));
      }
    }
  }

  // Query param (GET requests only) — also subject to legacy gate
  if (!token && req.method === 'GET' && req.query.token) {
    if (legacyEnabled) {
      token = req.query.token;
    }
  }

  if (!token) return null;

  // Hash token for lookup (tokens stored as SHA-256 hashes)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // tokens.json read is only reached here when legacyEnabled (token was set above)
  const entry = tokenStore.tokens?.[token] || tokenStore.tokens?.[tokenHash];
  if (!entry) return null;

  const role = ROLES[entry.role] || ROLES.viewer;

  return {
    userId: entry.userId || entry.name || 'unknown',
    name: entry.name || 'Unknown',
    role: entry.role || 'viewer',
    devAllowed: role.devAllowed,
    skills: role.skills,
    canAdmin: role.canAdmin,
    canSealAudit: role.canSealAudit,
    canClearRAG: role.canClearRAG,
    maxAgentTier: role.maxAgentTier,
    level: role.level,
    tokenId: tokenHash.slice(0, 8),
    scopes: entry.scopes || null  // optional per-token scope override
  };
}

/**
 * Auth middleware factory
 * @param {object} opts - { required: bool, minLevel: int, requireAdmin: bool, requireDev: bool }
 */
function authMiddleware(opts = {}) {
  const { required = true, minLevel = 0, requireAdmin = false, requireDev = false } = opts;

  return function(req, res, next) {
    const user = resolveUser(req);

    if (!user) {
      if (!required) {
        req.user = { userId: 'anon', name: 'Anonymous', role: 'viewer', level: 0, devAllowed: false, skills: ['compute'], canAdmin: false };
        return next();
      }
      return res.status(401).json({ error: 'Authentication required', hint: 'Provide X-KURO-Token header or Authorization: Bearer <token>' });
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

// Pre-built middleware for common patterns
const auth = {
  required: authMiddleware({ required: true }),
  optional: authMiddleware({ required: false }),
  operator: authMiddleware({ required: true, minLevel: 3 }),
  analyst: authMiddleware({ required: true, minLevel: 2 }),
  dev: authMiddleware({ required: true, requireDev: true }),
  admin: authMiddleware({ required: true, requireAdmin: true })
};

/**
 * Generate a token file with initial operator token
 * Called by deploy.sh if no token file exists
 */
function generateTokenFile(outputPath) {
  const token = crypto.randomBytes(32).toString('base64url');
  const store = {
    _comment: "KURO OS token store. Tokens are plaintext here; hash in production.",
    created: new Date().toISOString(),
    tokens: {
      [token]: {
        name: "Operator",
        userId: "operator",
        role: "operator",
        created: new Date().toISOString()
      }
    }
  };
  fs.writeFileSync(outputPath, JSON.stringify(store, null, 2));
  return { token, path: outputPath };
}

/**
 * Client fingerprint from request headers
 */
function fingerprint(req) {
  const raw = [
    req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '',
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || ''
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

// Init — only load tokens.json when legacy token auth is explicitly enabled
if (process.env.KURO_ENABLE_LEGACY_TOKEN === 'true') {
  loadTokens();
  watchTokenFile();
} else {
  console.log('[AUTH] Legacy token auth disabled (KURO_ENABLE_LEGACY_TOKEN not set to true)');
}

module.exports = { resolveUser, authMiddleware, auth, generateTokenFile, fingerprint, ROLES, loadTokens };
