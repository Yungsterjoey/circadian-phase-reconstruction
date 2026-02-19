/**
 * KURO::CONNECTORS v2.0
 * Permission-scoped, redacted, audited data access
 * 
 * Fixes from review:
 *   B) Read scopes: whitelisted dirs, redaction layer for secrets
 *   C) Exec contract: exact binary + arg patterns, stdout/stderr hashes in audit
 *   D) Write fence: runtime writes to /var/lib/kuro/ only, patches staging area
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { logEvent } = require('./audit_chain.js');

const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const CODE_DIR = process.env.KURO_CODE || '/opt/kuro';
const PATCHES_DIR = path.join(DATA_DIR, 'patches');

if (!fs.existsSync(PATCHES_DIR)) fs.mkdirSync(PATCHES_DIR, { recursive: true });

// ═══════════════════════════════════════════════════════════════════════════
// READ SCOPES — whitelisted directories per agent tier
// ═══════════════════════════════════════════════════════════════════════════
const READ_SCOPES = {
  // Insights: can read docs and public content only
  insights: [
    path.join(DATA_DIR, 'docs'),
    path.join(DATA_DIR, 'uploads'),
    path.join(DATA_DIR, 'vectors')
  ],
  // Analysis: can read docs + sessions (for aggregation) + vectors
  analysis: [
    path.join(DATA_DIR, 'docs'),
    path.join(DATA_DIR, 'uploads'),
    path.join(DATA_DIR, 'vectors'),
    path.join(DATA_DIR, 'sessions')
  ],
  // Actions: can read everything in data + code (for dev work)
  actions: [
    DATA_DIR,
    CODE_DIR
  ]
};

// Directories that are NEVER readable by any agent
const READ_DENYLIST = [
  '/etc/kuro',              // signing keys, config secrets
  path.join(DATA_DIR, 'audit'),  // audit logs (read via API only)
  '/root', '/home',
  '/etc/shadow', '/etc/passwd'
];

// ═══════════════════════════════════════════════════════════════════════════
// REDACTION — strip secrets before content reaches model
// ═══════════════════════════════════════════════════════════════════════════
const SECRET_PATTERNS = [
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, replace: '[REDACTED:password]' },
  { pattern: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"]?\S+['"]?/gi, replace: '[REDACTED:api_key]' },
  { pattern: /(?:token|bearer)\s*[:=]\s*['"]?[A-Za-z0-9_\-.]+['"]?/gi, replace: '[REDACTED:token]' },
  { pattern: /-----BEGIN (?:RSA |EC |ED25519 )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ED25519 )?PRIVATE KEY-----/g, replace: '[REDACTED:private_key]' },
  { pattern: /(?:mongodb|postgres|mysql|redis):\/\/\S+/gi, replace: '[REDACTED:connection_string]' },
  { pattern: /(?:AWS_SECRET|aws_secret)\S*\s*[:=]\s*\S+/gi, replace: '[REDACTED:aws_secret]' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, replace: '[REDACTED:email]' }
];

function redact(content) {
  let result = content;
  let redactions = 0;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    const matches = result.match(pattern);
    if (matches) { redactions += matches.length; result = result.replace(pattern, replace); }
  }
  return { content: result, redactions };
}

// ═══════════════════════════════════════════════════════════════════════════
// PATH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════
function validateReadPath(filePath, agentId) {
  const resolved = path.resolve(filePath);

  // Check denylist first
  for (const deny of READ_DENYLIST) {
    if (resolved.startsWith(deny)) return { resolved, allowed: false, reason: 'Denied path' };
  }

  // Check agent-specific read scopes
  const scopes = READ_SCOPES[agentId] || READ_SCOPES.insights;
  const allowed = scopes.some(scope => resolved.startsWith(scope));
  return { resolved, allowed, reason: allowed ? null : `Not in ${agentId} read scope` };
}

function validateWritePath(filePath) {
  const resolved = path.resolve(filePath);
  // Runtime writes go ONLY to /var/lib/kuro/ — never to code paths
  if (!resolved.startsWith(DATA_DIR)) {
    return { resolved, allowed: false, reason: 'Writes restricted to data directory' };
  }
  // Never write to audit
  if (resolved.startsWith(path.join(DATA_DIR, 'audit'))) {
    return { resolved, allowed: false, reason: 'Audit directory is immutable' };
  }
  return { resolved, allowed: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE CONNECTOR
// ═══════════════════════════════════════════════════════════════════════════
const file = {
  read: function(filePath, userId, agentId) {
    const { resolved, allowed, reason } = validateReadPath(filePath, agentId || 'insights');
    if (!allowed) {
      logEvent({ agent: `connector:file`, action: 'read_denied', target: filePath, result: 'denied', userId, meta: { reason } });
      throw new Error('Read denied: ' + reason);
    }
    if (!fs.existsSync(resolved)) throw new Error('Not found: ' + filePath);
    logEvent({ agent: 'connector:file', action: 'read', target: resolved, userId });
    const raw = fs.readFileSync(resolved, 'utf8');
    const { content, redactions } = redact(raw);
    if (redactions > 0) {
      logEvent({ agent: 'connector:file', action: 'redact', target: resolved, userId, meta: { redactions } });
    }
    return content;
  },

  write: function(filePath, content, userId) {
    const { resolved, allowed, reason } = validateWritePath(filePath);
    if (!allowed) {
      logEvent({ agent: 'connector:file', action: 'write_denied', target: filePath, result: 'denied', userId, meta: { reason } });
      throw new Error('Write denied: ' + reason);
    }
    if (fs.existsSync(resolved)) {
      const bakPath = resolved + '.bak.' + Date.now();
      fs.copyFileSync(resolved, bakPath);
      logEvent({ agent: 'connector:file', action: 'backup', target: bakPath, userId });
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    logEvent({ agent: 'connector:file', action: 'write', target: resolved, userId, meta: { size: content.length, sha256: hash } });
    return { success: true, path: resolved, size: content.length, sha256: hash };
  },

  /**
   * Stage a code patch — writes to /var/lib/kuro/patches/ instead of /opt/kuro/
   * Requires a separate "promote" step to apply
   */
  stagePatch: function(targetPath, content, userId) {
    const patchId = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const patchMeta = {
      id: patchId,
      targetPath,
      created: new Date().toISOString(),
      userId,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      size: content.length,
      status: 'staged'
    };
    const patchDir = path.join(PATCHES_DIR, patchId);
    fs.mkdirSync(patchDir, { recursive: true });
    fs.writeFileSync(path.join(patchDir, 'content'), content, 'utf8');
    fs.writeFileSync(path.join(patchDir, 'meta.json'), JSON.stringify(patchMeta, null, 2));
    logEvent({ agent: 'connector:file', action: 'stage_patch', target: targetPath, userId, meta: { patchId, sha256: patchMeta.sha256 } });
    return patchMeta;
  },

  remove: function(filePath, userId) {
    const { resolved, allowed, reason } = validateWritePath(filePath);
    if (!allowed) {
      logEvent({ agent: 'connector:file', action: 'delete_denied', target: filePath, result: 'denied', userId, meta: { reason } });
      throw new Error('Delete denied: ' + reason);
    }
    if (!fs.existsSync(resolved)) throw new Error('Not found: ' + filePath);
    const bakPath = resolved + '.deleted.' + Date.now();
    fs.copyFileSync(resolved, bakPath);
    fs.unlinkSync(resolved);
    logEvent({ agent: 'connector:file', action: 'delete', target: resolved, userId, meta: { backup: bakPath } });
    return { success: true, path: resolved, backup: bakPath };
  },

  list: function(dirPath, userId, agentId) {
    const { resolved, allowed, reason } = validateReadPath(dirPath, agentId || 'insights');
    if (!allowed) {
      logEvent({ agent: 'connector:file', action: 'list_denied', target: dirPath, result: 'denied', userId, meta: { reason } });
      throw new Error('List denied: ' + reason);
    }
    if (!fs.existsSync(resolved)) throw new Error('Not found: ' + dirPath);
    logEvent({ agent: 'connector:file', action: 'list', target: resolved, userId });
    return fs.readdirSync(resolved, { withFileTypes: true }).map(e => {
      try { const s = fs.statSync(path.join(resolved, e.name)); return { name: e.name, isDir: e.isDirectory(), size: s.size, modified: s.mtime }; }
      catch { return { name: e.name, isDir: e.isDirectory() }; }
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// TERMINAL CONNECTOR — formalized command contract
// ═══════════════════════════════════════════════════════════════════════════

// Exact binary allowlist with optional arg restrictions
const COMMAND_CONTRACT = {
  // Safe read-only
  ls:      { maxArgs: 10, denyArgs: [] },
  cat:     { maxArgs: 5, denyArgs: ['/etc/shadow', '/etc/kuro'] },
  head:    { maxArgs: 5, denyArgs: [] },
  tail:    { maxArgs: 5, denyArgs: [] },
  grep:    { maxArgs: 10, denyArgs: [] },
  find:    { maxArgs: 10, denyArgs: [] },
  pwd:     { maxArgs: 0, denyArgs: [] },
  echo:    { maxArgs: 20, denyArgs: [] },
  wc:      { maxArgs: 5, denyArgs: [] },
  df:      { maxArgs: 3, denyArgs: [] },
  du:      { maxArgs: 5, denyArgs: [] },
  uptime:  { maxArgs: 0, denyArgs: [] },
  free:    { maxArgs: 2, denyArgs: [] },
  ps:      { maxArgs: 5, denyArgs: [] },
  // Dev tools
  npm:     { maxArgs: 20, denyArgs: ['--global', '-g'] },
  node:    { maxArgs: 10, denyArgs: ['--eval', '-e'] },
  npx:     { maxArgs: 15, denyArgs: [] },
  git:     { maxArgs: 15, denyArgs: ['push', 'remote'] },
  diff:    { maxArgs: 5, denyArgs: [] },
  // File ops (sandboxed by cwd enforcement)
  mkdir:   { maxArgs: 5, denyArgs: [] },
  touch:   { maxArgs: 3, denyArgs: [] },
  cp:      { maxArgs: 5, denyArgs: ['-r /'] },
  mv:      { maxArgs: 3, denyArgs: [] },
  // Monitoring
  ollama:  { maxArgs: 10, denyArgs: ['serve'] },
  pm2:     { maxArgs: 5, denyArgs: ['delete', 'kill'] }
};

// Absolute denylist patterns (checked against full command string)
const COMMAND_DENYLIST = [
  /rm\s+-rf\s+\/(?!\w)/,
  /rm\s+-rf\s+\*/,
  /mkfs\./,
  /dd\s+if=.*of=\/dev/,
  /:()\s*{\s*:|:&\s*};:/,
  /sudo/,
  /su\s+/,
  /bash|sh\s+-c|zsh|csh|fish/,     // no shell interpreters
  /python|python3|perl|ruby/,       // no script interpreters (removable per profile)
  /curl.*\|\s*(bash|sh)/,
  /wget.*\|\s*(bash|sh)/,
  /nc\s|ncat\s|netcat\s/,           // no netcat
  /nmap|masscan|nikto/,             // no scanners
  /iptables|ufw/,                   // no firewall changes
  /systemctl\s+(stop|disable|mask)/  // no service disruption
];

const terminal = {
  exec: function(command, cwd, userId, requestId) {
    return new Promise((resolve, reject) => {
      const cmd = command.trim();
      const parts = cmd.split(/\s+/);
      const binary = parts[0];
      const args = parts.slice(1);

      // Contract check
      const contract = COMMAND_CONTRACT[binary];
      if (!contract) {
        logEvent({ agent: 'connector:terminal', action: 'exec_denied', target: cmd, result: 'denied', userId, meta: { reason: 'not_in_contract', requestId } });
        return reject(new Error(`'${binary}' not in command contract`));
      }

      // Arg count check
      if (args.length > contract.maxArgs) {
        logEvent({ agent: 'connector:terminal', action: 'exec_denied', target: cmd, result: 'denied', userId, meta: { reason: 'too_many_args', requestId } });
        return reject(new Error(`'${binary}' max ${contract.maxArgs} args, got ${args.length}`));
      }

      // Denied args check
      for (const deny of contract.denyArgs) {
        if (args.some(a => a.includes(deny))) {
          logEvent({ agent: 'connector:terminal', action: 'exec_denied', target: cmd, result: 'denied', userId, meta: { reason: 'denied_arg', arg: deny, requestId } });
          return reject(new Error(`Arg '${deny}' not allowed for '${binary}'`));
        }
      }

      // Denylist pattern check
      for (const pattern of COMMAND_DENYLIST) {
        if (pattern.test(cmd)) {
          logEvent({ agent: 'connector:terminal', action: 'exec_blocked', target: cmd, result: 'denied', userId, meta: { reason: 'denylist_match', requestId } });
          return reject(new Error('Blocked: dangerous pattern'));
        }
      }

      // CWD enforcement: must be within data or code dirs
      const resolvedCwd = path.resolve(cwd || DATA_DIR);
      if (!resolvedCwd.startsWith(DATA_DIR) && !resolvedCwd.startsWith(CODE_DIR)) {
        logEvent({ agent: 'connector:terminal', action: 'exec_denied', target: cmd, result: 'denied', userId, meta: { reason: 'cwd_outside_sandbox', cwd: resolvedCwd, requestId } });
        return reject(new Error('CWD outside sandbox'));
      }

      logEvent({ agent: 'connector:terminal', action: 'exec', target: cmd, userId, meta: { cwd: resolvedCwd, requestId } });

      execFile(binary, args, {
        cwd: resolvedCwd,
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8'
      }, (err, stdout, stderr) => {
        // Hash stdout/stderr for audit correlation
        const stdoutHash = crypto.createHash('sha256').update(stdout || '').digest('hex').slice(0, 16);
        const stderrHash = crypto.createHash('sha256').update(stderr || '').digest('hex').slice(0, 16);
        const code = err ? (err.code || 1) : 0;

        logEvent({
          agent: 'connector:terminal', action: 'exec_result', target: cmd,
          result: code === 0 ? 'ok' : 'error', userId,
          meta: { code, stdoutHash, stderrHash, stdoutLen: (stdout||'').length, stderrLen: (stderr||'').length, requestId }
        });

        resolve({ stdout: stdout || '', stderr: stderr || (err ? err.message : ''), code });
      });
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SESSION CONNECTOR
// ═══════════════════════════════════════════════════════════════════════════
const session = {
  read: function(sessionId, userId) {
    const sessionPath = path.join(DATA_DIR, 'sessions', `${sessionId}.json`);
    if (!fs.existsSync(sessionPath)) return null;
    logEvent({ agent: 'connector:session', action: 'read', target: sessionId, userId });
    const raw = fs.readFileSync(sessionPath, 'utf8');
    const { content } = redact(raw);
    return JSON.parse(content);
  },

  aggregate: function(userId) {
    const sessDir = path.join(DATA_DIR, 'sessions');
    logEvent({ agent: 'connector:session', action: 'aggregate', userId });
    try {
      const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.json'));
      return {
        totalSessions: files.length,
        sessions: files.slice(0, 100).map(f => {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(sessDir, f), 'utf8'));
            return { id: f.replace('.json', ''), messages: (data.history || []).length, lastAccess: data.lastAccess };
          } catch { return { id: f.replace('.json', ''), error: true }; }
        })
      };
    } catch { return { totalSessions: 0, sessions: [] }; }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GATED CONNECTOR FACTORY
// ═══════════════════════════════════════════════════════════════════════════
function createGatedConnectors(skillGates, userId, agentId) {
  const deny = (action) => () => {
    logEvent({ agent: agentId, action: action + '_denied', result: 'denied', userId });
    throw new Error(`Agent ${agentId} lacks ${action} skill`);
  };

  return {
    file: {
      read:   skillGates.canRead  ? (fp) => file.read(fp, userId, agentId) : deny('read'),
      write:  skillGates.canWrite ? (fp, c) => file.write(fp, c, userId) : deny('write'),
      stagePatch: skillGates.canWrite ? (tp, c) => file.stagePatch(tp, c, userId) : deny('write'),
      remove: skillGates.canWrite ? (fp) => file.remove(fp, userId) : deny('write'),
      list:   skillGates.canRead  ? (dp) => file.list(dp, userId, agentId) : deny('read')
    },
    terminal: {
      exec: skillGates.canExec ? (cmd, cwd, rid) => terminal.exec(cmd, cwd, userId, rid) : deny('exec')
    },
    session: {
      read:      skillGates.canRead     ? (sid) => session.read(sid, userId) : deny('read'),
      aggregate: skillGates.canAggregate ? ()    => session.aggregate(userId) : deny('aggregate')
    }
  };
}

module.exports = {
  file, terminal, session,
  createGatedConnectors, redact,
  validateReadPath, validateWritePath,
  READ_SCOPES, COMMAND_CONTRACT,
  DATA_DIR, CODE_DIR, PATCHES_DIR
};
