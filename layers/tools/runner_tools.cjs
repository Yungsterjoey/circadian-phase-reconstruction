/**
 * KURO Runner Tool Bindings v1.0
 * Agent-callable tools for spawning, monitoring, and killing runner jobs.
 * Each invocation is logged to the tool_calls table.
 *
 * Usage:
 *   const { runRunnerTool } = require('./layers/tools/runner_tools.cjs');
 *   const result = await runRunnerTool('runner_spawn', args, userId, db);
 */

const RUNNER_TOOLS = {
  runner_spawn: {
    description: 'Spawn a sandboxed execution job (Python or Node.js). Returns jobId.',
    schema: {
      type: 'object',
      required: ['cmd'],
      properties: {
        cmd:       { type: 'string',  description: 'Entry-point filename (e.g. main.py, index.js)' },
        lang:      { type: 'string',  enum: ['python', 'node'], description: 'Language runtime' },
        projectId: { type: 'string',  description: 'VFS project ID for workspace snapshot' },
        snapshot:  { type: 'boolean', description: 'If true, materialize VFS snapshot as workspace' },
      },
    },
    async run({ cmd, lang = 'python', projectId, snapshot = false }, userId, db) {
      if (!userId || userId === 'anon') throw new Error('runner_spawn requires authenticated userId');
      if (!cmd) throw new Error('cmd is required');

      const crypto = require('crypto');
      const fs = require('fs');
      const path = require('path');
      const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
      const JOB_DIR  = path.join(DATA_DIR, 'runner_jobs');

      // Resolve budgets from user tier
      const userRow = db.prepare('SELECT tier FROM users WHERE id = ?').get(userId);
      const tier = userRow?.tier || 'pro';
      const BUDGETS = {
        pro:       { max_seconds: 15, max_output_bytes: 524288 },
        sovereign: { max_seconds: 60, max_output_bytes: 2097152 },
      };
      const budgets = BUDGETS[tier] || BUDGETS.pro;

      const jobId = crypto.randomBytes(16).toString('hex');
      fs.mkdirSync(path.join(JOB_DIR, jobId, 'workspace'), { recursive: true });

      db.prepare(`INSERT INTO runner_jobs (job_id, user_id, project_id, cmd, lang, status, max_seconds, max_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
        .run(jobId, userId, projectId || null, cmd, lang, budgets.max_seconds, budgets.max_output_bytes, Date.now());

      // Trigger execution via runner_routes internals
      try {
        const mountRunner = require('../runner/runner_routes.cjs');
        setImmediate(() => mountRunner._executeJob(jobId, db));
      } catch { /* runner not loaded */ }

      return { jobId, status: 'queued', lang, cmd };
    },
  },

  runner_status: {
    description: 'Get the current status of a runner job.',
    schema: {
      type: 'object',
      required: ['jobId'],
      properties: { jobId: { type: 'string' } },
    },
    async run({ jobId }, userId, db) {
      const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id=? AND user_id=?').get(jobId, userId);
      if (!row) throw new Error(`Job not found: ${jobId}`);
      return {
        jobId: row.job_id, status: row.status, exitCode: row.exit_code,
        lang: row.lang, cmd: row.cmd,
        createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
      };
    },
  },

  runner_kill: {
    description: 'Kill a running job.',
    schema: {
      type: 'object',
      required: ['jobId'],
      properties: { jobId: { type: 'string' } },
    },
    async run({ jobId }, userId, db) {
      const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id=? AND user_id=?').get(jobId, userId);
      if (!row) throw new Error(`Job not found: ${jobId}`);
      if (!['queued','running'].includes(row.status)) return { ok: false, reason: 'not_running', status: row.status };

      try {
        const mountRunner = require('../runner/runner_routes.cjs');
        const job = mountRunner._activeJobs.get(jobId);
        if (job?.proc && !job.proc.killed) {
          job.proc.kill('SIGKILL');
          mountRunner._dispatch(jobId, { t: 'sys', ts: Date.now(), d: '[RUNNER] Killed by agent\n' });
          mountRunner._dispatch(jobId, { t: 'status', ts: Date.now(), status: 'killed', exitCode: -1 });
        }
      } catch { /* runner not loaded */ }

      db.prepare('UPDATE runner_jobs SET status=?, exit_code=-1, finished_at=? WHERE job_id=?')
        .run('killed', Date.now(), jobId);
      return { ok: true, status: 'killed' };
    },
  },

  runner_logs: {
    description: 'Return the tail of log output for a job (up to last 200 lines).',
    schema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        limit: { type: 'number', description: 'Max log rows to return (default 100)' },
      },
    },
    async run({ jobId, limit = 100 }, userId, db) {
      const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id=? AND user_id=?').get(jobId, userId);
      if (!row) throw new Error(`Job not found: ${jobId}`);
      const logs = db.prepare(
        'SELECT ts, stream, chunk FROM runner_logs WHERE job_id=? ORDER BY id DESC LIMIT ?'
      ).all(jobId, Math.min(limit, 200)).reverse();
      return { jobId, status: row.status, exitCode: row.exit_code, logs };
    },
  },
};

/**
 * Execute a runner tool, logging the call to tool_calls table.
 * @param {string} toolName
 * @param {object} args
 * @param {string} userId
 * @param {object} db  — better-sqlite3 instance
 */
async function runRunnerTool(toolName, args, userId, db) {
  if (!userId || userId === 'anon') throw new Error('Runner tools require authenticated userId');
  const tool = RUNNER_TOOLS[toolName];
  if (!tool) throw new Error(`Unknown runner tool: ${toolName}`);

  const ts    = Date.now();
  let output  = null;
  let status  = 'ok';
  let ms      = 0;

  try {
    output = await tool.run(args || {}, userId, db);
    ms = Date.now() - ts;
  } catch (e) {
    status = 'error';
    ms     = Date.now() - ts;
    // Log failure
    try {
      db.prepare('INSERT INTO tool_calls (user_id, ts, tool, input_json, output_json, status, ms) VALUES (?,?,?,?,?,?,?)')
        .run(userId, ts, toolName, JSON.stringify(args), JSON.stringify({ error: e.message }), 'error', ms);
    } catch { /* non-fatal */ }
    throw e;
  }

  try {
    db.prepare('INSERT INTO tool_calls (user_id, ts, tool, input_json, output_json, status, ms) VALUES (?,?,?,?,?,?,?)')
      .run(userId, ts, toolName, JSON.stringify(args), JSON.stringify(output), status, ms);
  } catch { /* non-fatal */ }

  return output;
}

module.exports = { RUNNER_TOOLS, runRunnerTool };
