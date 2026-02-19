/**
 * KURO::VALIDATOR v1.0
 * Input sanitization + request validation
 *
 * Fixes: C3 (path traversal), C4 (session ID injection), C5 (filename injection),
 *        H6 (no body validation), M1 (body size)
 */

const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// SANITIZERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sanitize session ID — alphanumeric + hyphens only, max 64 chars
 */
function sanitizeSessionId(sid) {
  if (!sid || typeof sid !== 'string') return null;
  const clean = sid.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  return clean.length > 0 ? clean : null;
}

/**
 * Sanitize filename — strip path separators, control chars, limit length
 */
function sanitizeFilename(fn) {
  if (!fn || typeof fn !== 'string') return `upload_${Date.now()}`;
  return fn
    .replace(/[\/\\:*?"<>|]/g, '_')   // strip path/shell chars
    .replace(/\.\./g, '_')            // strip traversal
    .replace(/[^\x20-\x7E]/g, '')     // strip non-printable
    .slice(0, 128)                     // limit length
    || `upload_${Date.now()}`;
}

/**
 * Validate path is within allowed sandboxes
 */
function validatePath(filePath, sandboxes) {
  if (!filePath || typeof filePath !== 'string') return { safe: false, reason: 'empty path' };
  const resolved = path.resolve(filePath);
  const inSandbox = sandboxes.some(sb => resolved.startsWith(sb));
  if (!inSandbox) return { safe: false, reason: `Outside sandbox: ${resolved}`, resolved };
  // Check for null bytes
  if (filePath.includes('\0')) return { safe: false, reason: 'Null byte in path' };
  return { safe: true, resolved };
}

/**
 * Validate and clamp numeric parameter
 */
function clampInt(val, min, max, defaultVal) {
  const n = parseInt(val);
  if (isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

/**
 * Validate mode string
 */
function validateMode(mode) {
  const VALID = ['main', 'dev', 'bloodhound', 'war_room'];
  return VALID.includes(mode) ? mode : 'main';
}

/**
 * Validate namespace
 */
function validateNamespace(ns) {
  const VALID = ['edubba', 'mnemosyne'];
  return VALID.includes(ns) ? ns : 'edubba';
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA VALIDATORS (lightweight, no deps)
// ═══════════════════════════════════════════════════════════════════════════

const SCHEMAS = {
  stream: {
    required: [],
    optional: {
      messages: 'array', mode: 'string', skill: 'string', temperature: 'number',
      clientType: 'string', sessionId: 'string', images: 'array',
      thinking: 'boolean', reasoning: 'boolean', incubation: 'boolean',
      redTeam: 'boolean', nuclearFusion: 'boolean',
      useRAG: 'boolean', ragNamespace: 'string', ragTopK: 'number'
    },
    maxSize: 5 * 1024 * 1024  // 5MB max for chat
  },
  devExec: {
    required: ['command'],
    optional: { cwd: 'string' },
    maxSize: 64 * 1024  // 64KB max for commands
  },
  devWrite: {
    required: ['filePath'],
    optional: { content: 'string', action: 'string' },
    maxSize: 10 * 1024 * 1024  // 10MB max for file writes
  },
  devRead: {
    required: ['filePath'],
    optional: {},
    maxSize: 4096
  },
  ingest: {
    required: [],
    optional: { filePath: 'string', content: 'string', namespace: 'string', metadata: 'object' },
    maxSize: 10 * 1024 * 1024
  },
  embed: {
    required: [],
    optional: { text: 'string', texts: 'array' },
    maxSize: 1 * 1024 * 1024
  },
  ragQuery: {
    required: ['query'],
    optional: { namespace: 'string', topK: 'number', threshold: 'number' },
    maxSize: 64 * 1024
  }
};

/**
 * Validate request body against schema
 * Returns { valid: boolean, errors: string[] }
 */
function validateBody(body, schemaName) {
  const schema = SCHEMAS[schemaName];
  if (!schema) return { valid: true, errors: [] };

  const errors = [];

  // Check required fields
  for (const field of schema.required) {
    if (body[field] === undefined || body[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check types
  const allFields = { ...Object.fromEntries(schema.required.map(f => [f, typeof body[f] === 'string' ? 'string' : typeof body[f]])), ...schema.optional };
  for (const [field, expectedType] of Object.entries(allFields)) {
    if (body[field] === undefined) continue;
    const actual = Array.isArray(body[field]) ? 'array' : typeof body[field];
    if (actual !== expectedType && expectedType !== undefined) {
      // Allow string-to-number coercion for numeric fields
      if (expectedType === 'number' && !isNaN(Number(body[field]))) continue;
      errors.push(`Field '${field}' expected ${expectedType}, got ${actual}`);
    }
  }

  // Check body size (rough estimate)
  const bodySize = JSON.stringify(body).length;
  if (bodySize > schema.maxSize) {
    errors.push(`Body too large: ${bodySize} bytes (max ${schema.maxSize})`);
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');  // Modern browsers: CSP instead
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS only if behind TLS
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP for the frontend
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'");
  }
  next();
}

/**
 * Request ID middleware — attaches unique requestId to every request
 */
function requestId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || require('crypto').randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

module.exports = {
  sanitizeSessionId, sanitizeFilename, validatePath, clampInt,
  validateMode, validateNamespace, validateBody, SCHEMAS,
  securityHeaders, requestId
};
