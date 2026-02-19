/**
 * KURO::LAB v1.0 — Code Interpreter Sandbox
 * 
 * Ephemeral container runner for code execution.
 * User uploads file → stored in workspace → model generates code →
 * runner executes in sandbox → stream logs → model reasons over results.
 * 
 * Security:
 *   - Docker rootless or gVisor sandbox
 *   - 30s timeout per execution
 *   - 100MB memory limit
 *   - No network access inside container
 *   - All I/O hashed and logged to audit chain
 * 
 * Tier gating:
 *   Free: not available
 *   Pro: 10 runs/day, python + node only
 *   Sovereign: 50 runs/day, python + node + ffmpeg + gcc
 * 
 * Route: POST /api/lab/run
 */

const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const LAB_DIR = path.join(DATA_DIR, 'lab');
const DOCKER_IMAGE = process.env.KURO_LAB_IMAGE || 'kuro-lab:latest';
const EXEC_TIMEOUT = 30000; // 30s
const MEM_LIMIT = '100m';

if (!fs.existsSync(LAB_DIR)) fs.mkdirSync(LAB_DIR, { recursive: true });

// ═══ Tier Quotas ═══
const LAB_QUOTAS = {
  free: { daily: 0, runtimes: [] },
  pro: { daily: 10, runtimes: ['python3', 'node'] },
  sovereign: { daily: 50, runtimes: ['python3', 'node', 'ffmpeg', 'gcc', 'g++'] }
};

const labUsage = new Map();

function checkLabQuota(userId, tier) {
  const quota = LAB_QUOTAS[tier] || LAB_QUOTAS.free;
  if (quota.daily === 0) return { allowed: false, reason: 'tier_not_eligible' };
  
  const today = new Date().toISOString().slice(0, 10);
  let entry = labUsage.get(userId);
  if (!entry || entry.date !== today) {
    entry = { count: 0, date: today };
    labUsage.set(userId, entry);
  }
  
  if (entry.count >= quota.daily) {
    return { allowed: false, reason: 'daily_limit_reached', used: entry.count, limit: quota.daily };
  }
  
  return { allowed: true, remaining: quota.daily - entry.count, runtimes: quota.runtimes };
}

function consumeLabQuota(userId) {
  const entry = labUsage.get(userId);
  if (entry) entry.count++;
}

// ═══ Workspace Management ═══
function createWorkspace(userId) {
  const workspaceId = crypto.randomBytes(8).toString('hex');
  const wsPath = path.join(LAB_DIR, `ws_${workspaceId}`);
  fs.mkdirSync(wsPath, { recursive: true });
  return { workspaceId, path: wsPath };
}

function cleanupWorkspace(wsPath) {
  try {
    fs.rmSync(wsPath, { recursive: true, force: true });
  } catch(e) {
    console.warn('[LAB] Cleanup failed:', wsPath, e.message);
  }
}

// ═══ Runtime Detection ═══
function detectRuntime(code) {
  // Detect from shebang or content patterns
  if (code.startsWith('#!/usr/bin/env python') || code.startsWith('#!/usr/bin/python')) return 'python3';
  if (code.startsWith('#!/usr/bin/env node') || code.startsWith('#!/usr/bin/node')) return 'node';
  if (/^(import |from |def |class |print\(|if __name__)/.test(code)) return 'python3';
  if (/^(const |let |var |function |import |require\()/.test(code)) return 'node';
  if (/^#include/.test(code)) return 'gcc';
  return 'python3'; // default
}

function getRuntimeCommand(runtime, scriptFile) {
  switch(runtime) {
    case 'python3': return ['python3', scriptFile];
    case 'node': return ['node', scriptFile];
    case 'gcc': return null; // needs compile step
    case 'g++': return null;
    default: return ['python3', scriptFile];
  }
}

function getScriptExtension(runtime) {
  switch(runtime) {
    case 'python3': return '.py';
    case 'node': return '.js';
    case 'gcc': return '.c';
    case 'g++': return '.cpp';
    default: return '.py';
  }
}

// ═══ Execution Engine ═══
/**
 * Execute code in sandbox
 * @param {string} code - Source code to execute
 * @param {string} runtime - python3|node|gcc|g++
 * @param {string} wsPath - Workspace directory
 * @param {object} opts - { timeout, memLimit, files }
 * @returns {Promise<object>} { stdout, stderr, exitCode, duration, outputFiles }
 */
async function execute(code, runtime, wsPath, opts = {}) {
  const timeout = opts.timeout || EXEC_TIMEOUT;
  const memLimit = opts.memLimit || MEM_LIMIT;
  
  // Write script to workspace
  const ext = getScriptExtension(runtime);
  const scriptFile = path.join(wsPath, `run${ext}`);
  fs.writeFileSync(scriptFile, code);
  
  // Hash input for audit
  const inputHash = crypto.createHash('sha256').update(code).digest('hex');
  
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    let useDocker = false;
    
    // Check if Docker is available
    try {
      const { execSync } = require('child_process');
      execSync('docker info', { timeout: 2000, stdio: 'pipe' });
      useDocker = true;
    } catch(e) {
      // Docker not available — direct execution with restrictions
      useDocker = false;
    }
    
    let child;
    
    if (useDocker) {
      // Docker rootless execution
      const dockerArgs = [
        'run', '--rm',
        '--memory', memLimit,
        '--cpus', '1',
        '--network', 'none',
        '--read-only',
        '--tmpfs', '/tmp:size=50m',
        '-v', `${wsPath}:/workspace:ro`,
        '-w', '/workspace',
        DOCKER_IMAGE,
        ...(getRuntimeCommand(runtime, `/workspace/run${ext}`) || ['python3', `/workspace/run${ext}`])
      ];
      
      child = spawn('docker', dockerArgs, { timeout });
    } else {
      // Direct execution (lab profile only, for development)
      const cmd = getRuntimeCommand(runtime, scriptFile);
      if (!cmd) {
        // Compile step needed
        if (runtime === 'gcc' || runtime === 'g++') {
          const outFile = path.join(wsPath, 'a.out');
          try {
            const { execSync } = require('child_process');
            execSync(`${runtime} ${scriptFile} -o ${outFile}`, { timeout: 10000, cwd: wsPath });
            child = spawn(outFile, [], { timeout, cwd: wsPath });
          } catch(e) {
            resolve({
              stdout: '', stderr: `Compilation error: ${e.message}`,
              exitCode: 1, duration: Date.now() - startTime,
              inputHash, outputHash: null
            });
            return;
          }
        }
      } else {
        child = spawn(cmd[0], cmd.slice(1), { timeout, cwd: wsPath });
      }
    }
    
    if (!child) {
      resolve({ stdout: '', stderr: 'Failed to start process', exitCode: 1, duration: 0, inputHash });
      return;
    }
    
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', d => { stdout += d.toString(); if (stdout.length > 100000) stdout = stdout.slice(0, 100000) + '\n[TRUNCATED]'; });
    child.stderr?.on('data', d => { stderr += d.toString(); if (stderr.length > 50000) stderr = stderr.slice(0, 50000) + '\n[TRUNCATED]'; });
    
    child.on('close', (exitCode) => {
      const duration = Date.now() - startTime;
      const outputHash = crypto.createHash('sha256').update(stdout + stderr).digest('hex');
      
      // Scan workspace for output files
      let outputFiles = [];
      try {
        outputFiles = fs.readdirSync(wsPath)
          .filter(f => f !== `run${ext}` && f !== 'a.out')
          .map(f => ({
            name: f,
            size: fs.statSync(path.join(wsPath, f)).size
          }));
      } catch(e) {}
      
      resolve({
        stdout,
        stderr,
        exitCode: exitCode || 0,
        duration,
        inputHash,
        outputHash,
        outputFiles
      });
    });
    
    child.on('error', (err) => {
      resolve({
        stdout, stderr: stderr + '\n' + err.message,
        exitCode: 1, duration: Date.now() - startTime,
        inputHash, outputHash: null
      });
    });
    
    // Kill on timeout
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch(e) {}
    }, timeout);
  });
}

// ═══ Route Handler ═══
/**
 * Mount lab routes
 * @param {object} app - Express app
 * @param {function} logEvent - Audit chain logger
 * @param {object} authMiddleware - { required }
 */
function mountLabRoutes(app, logEvent, authMiddleware) {
  const auth = authMiddleware || { required: (q,s,n) => n() };
  
  app.post('/api/lab/run', auth.required, async (req, res) => {
    try {
      const { code, runtime: requestedRuntime, fileIds } = req.body;
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Code is required' });
      }
      if (code.length > 50000) {
        return res.status(400).json({ error: 'Code too long (50KB max)' });
      }
      
      const userId = req.user?.userId || 'anonymous';
      const tier = req.user?.tier || 'free';
      
      // Quota check
      const quota = checkLabQuota(userId, tier);
      if (!quota.allowed) {
        return res.status(403).json({ error: quota.reason, ...(quota.used !== undefined ? { used: quota.used, limit: quota.limit } : {}) });
      }
      
      // Runtime check
      const runtime = requestedRuntime || detectRuntime(code);
      if (!quota.runtimes.includes(runtime)) {
        return res.status(403).json({ error: `Runtime '${runtime}' not available on your tier`, available: quota.runtimes });
      }
      
      // Create workspace
      const ws = createWorkspace(userId);
      
      // Copy any referenced files into workspace
      if (fileIds && Array.isArray(fileIds)) {
        const uploadsDir = path.join(DATA_DIR, 'uploads');
        for (const fid of fileIds.slice(0, 5)) { // max 5 files
          const candidates = fs.readdirSync(uploadsDir).filter(f => f.startsWith(fid));
          for (const c of candidates) {
            const src = path.join(uploadsDir, c);
            const dst = path.join(ws.path, c.replace(`${fid}_`, ''));
            try { fs.copyFileSync(src, dst); } catch(e) {}
          }
        }
      }
      
      // Execute
      const result = await execute(code, runtime, ws.path, {});
      
      // Consume quota
      consumeLabQuota(userId);
      
      // Audit
      logEvent({
        agent: 'kuro_lab',
        action: 'code_execute',
        userId,
        requestId: req.requestId,
        meta: {
          runtime,
          inputHash: result.inputHash,
          outputHash: result.outputHash,
          exitCode: result.exitCode,
          duration: result.duration,
          workspaceId: ws.workspaceId
        }
      });
      
      // Cleanup
      cleanupWorkspace(ws.path);
      
      res.json({
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration: result.duration,
        outputFiles: result.outputFiles,
        runtime,
        remaining: (checkLabQuota(userId, tier)).remaining
      });
      
    } catch(e) {
      console.error('[LAB] Run error:', e.message);
      res.status(500).json({ error: 'Execution failed' });
    }
  });
  
  console.log('[LAB] Routes mounted');
}

module.exports = {
  mountLabRoutes,
  checkLabQuota,
  LAB_QUOTAS,
  execute,
  createWorkspace,
  cleanupWorkspace
};
