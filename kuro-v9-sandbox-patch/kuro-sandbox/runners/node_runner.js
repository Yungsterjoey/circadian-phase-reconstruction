/**
 * KURO Sandbox Node.js Runner Config v1.0
 *
 * Drop-in language config for the sandbox sidecar.
 * Returns the Docker args / firejail args for a Node.js job.
 *
 * This file is imported by index.js when lang='node'.
 */

'use strict';

const path = require('path');

const NODE_IMAGE = process.env.SANDBOX_NODE_IMAGE || 'node:18-alpine';

// Environment variables that must NEVER reach sandbox processes
const SECRET_ENV_PREFIXES = [
  'AWS_', 'VFS_S3_', 'KURO_', 'STRIPE_', 'GOOGLE_',
  'DB_', 'DATABASE_', 'POSTGRES_', 'MYSQL_', 'REDIS_',
  'OPENAI_', 'ANTHROPIC_', 'CLAUDE_',
];

/**
 * Strip secrets from an env object before passing to sandbox.
 * @param {object} env
 * @returns {object} scrubbed env
 */
function scrubEnv(env = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(env)) {
    const upper = k.toUpperCase();
    if (SECRET_ENV_PREFIXES.some(p => upper.startsWith(p))) continue;
    safe[k] = v;
  }
  return safe;
}

/**
 * Build Docker `run` arguments for a Node.js execution.
 * @param {{ workspacePath, entrypoint, budgets, artifactDir }} opts
 * @returns {string[]} docker run args (excluding 'docker')
 */
function dockerArgs({ workspacePath, entrypoint, budgets, artifactDir }) {
  const memLimit = `${budgets.max_memory_mb || 256}m`;
  return [
    'run', '--rm',
    '--network=none',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--memory', memLimit,
    '--memory-swap', memLimit,
    '--cpus', '1',
    '--pids-limit', '64',
    '--ulimit', 'nofile=256:256',
    '--security-opt', 'no-new-privileges',
    '-v', `${workspacePath}:/workspace:ro`,
    '-v', `${artifactDir}:/artifacts:rw`,
    '-w', '/workspace',
    '--env', `ARTIFACT_DIR=/artifacts`,
    NODE_IMAGE,
    'node', entrypoint || 'index.js',
  ];
}

/**
 * Build firejail arguments for a Node.js execution.
 * @param {{ workspacePath, entrypoint, budgets, artifactDir, timeoutHMS }} opts
 * @returns {string[]} firejail args (excluding 'firejail')
 */
function firejailArgs({ workspacePath, entrypoint, budgets, artifactDir, timeoutHMS }) {
  return [
    '--noprofile',
    '--net=none',
    '--noroot',
    `--rlimit-as=${(budgets.max_memory_mb || 256) * 1024 * 1024}`,
    `--timeout=${timeoutHMS}`,
    `--read-only=${workspacePath}`,
    `--whitelist=${artifactDir}`,
    '--',
    'node',
    path.join(workspacePath, entrypoint || 'index.js'),
  ];
}

/** Allowlisted binaries for Node.js sandbox (firejail private-bin) */
const ALLOWED_BINS = ['node', 'npm', 'npx', 'sh'];

module.exports = { dockerArgs, firejailArgs, scrubEnv, ALLOWED_BINS, NODE_IMAGE };
