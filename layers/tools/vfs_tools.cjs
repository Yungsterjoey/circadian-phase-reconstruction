/**
 * KURO VFS Tool Bindings v1.0
 * Exposes VFS adapter as callable tools in the agent pipeline.
 *
 * Usage:
 *   const { runVfsTool, VFS_TOOLS } = require('./layers/tools/vfs_tools.cjs');
 *   const result = await runVfsTool('vfs_list', { path: '/docs' }, userId);
 */

const { VfsAdapterError } = require('../vfs/vfs_adapter.interface.cjs');
const { S3VfsAdapter }    = require('../vfs/vfs_s3_adapter.cjs');

const BACKEND = process.env.VFS_BACKEND || 's3';

function getAdapter(userId) {
  // Extend here when Nextcloud backend lands
  return new S3VfsAdapter(userId);
}

const VFS_TOOLS = {
  vfs_list: {
    description: 'List directory contents in the user VFS.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path (default: root)' } },
      required: [],
    },
    async run({ path = '' }, userId) {
      const entries = await getAdapter(userId).list(path);
      return { path: path || '/', entries };
    },
  },

  vfs_read: {
    description: 'Read a file from the user VFS. Returns UTF-8 text content.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    async run({ path }, userId) {
      const { content, mimeType } = await getAdapter(userId).read(path);
      return { path, content: content.toString('utf8'), mimeType };
    },
  },

  vfs_write: {
    description: 'Write a UTF-8 text file to the user VFS.',
    schema: {
      type: 'object',
      properties: {
        path:     { type: 'string' },
        content:  { type: 'string' },
        mimeType: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    async run({ path, content, mimeType }, userId) {
      const result = await getAdapter(userId).write(path, content, { mimeType });
      return { ok: true, path, size: result.size };
    },
  },

  vfs_mkdir: {
    description: 'Create a directory in the user VFS.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    async run({ path }, userId) {
      await getAdapter(userId).mkdir(path);
      return { ok: true, path };
    },
  },

  vfs_rm: {
    description: 'Remove a file or directory from the user VFS.',
    schema: {
      type: 'object',
      properties: {
        path:      { type: 'string' },
        recursive: { type: 'boolean', description: 'Required for non-empty directories' },
      },
      required: ['path'],
    },
    async run({ path, recursive = false }, userId) {
      await getAdapter(userId).rm(path, recursive);
      return { ok: true };
    },
  },
};

/**
 * Execute a VFS tool by name.
 * @param {string} toolName
 * @param {object} args
 * @param {string} userId  — must be a real user id (not anon)
 */
async function runVfsTool(toolName, args, userId) {
  if (!userId || userId === 'anon' || userId === 'guest') {
    throw new Error('VFS tools require an authenticated userId');
  }
  const tool = VFS_TOOLS[toolName];
  if (!tool) throw new Error(`Unknown VFS tool: ${toolName}`);

  try {
    return await tool.run(args || {}, userId);
  } catch (e) {
    if (e instanceof VfsAdapterError) {
      throw new Error(`VFS ${toolName} failed [${e.code}]: ${e.message}`);
    }
    throw e;
  }
}

module.exports = { VFS_TOOLS, runVfsTool };
