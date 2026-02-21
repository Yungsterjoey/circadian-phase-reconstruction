/**
 * KURO VFS Adapter Interface v1.0
 *
 * All adapters extend VfsAdapter and implement the methods below.
 * Paths are RELATIVE to the user root (no leading slash required).
 * The adapter enforces per-user namespace isolation internally.
 *
 * Error codes used in VfsAdapterError:
 *   NOT_FOUND | PERMISSION_DENIED | QUOTA_EXCEEDED | CONFLICT | NOT_IMPLEMENTED | IO_ERROR
 */

class VfsAdapterError extends Error {
  /** @param {'NOT_FOUND'|'PERMISSION_DENIED'|'QUOTA_EXCEEDED'|'CONFLICT'|'NOT_IMPLEMENTED'|'IO_ERROR'} code */
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'VfsAdapterError';
  }
}

/**
 * @typedef {{ name: string, type: 'file'|'dir', size: number, modified: string }} VfsEntry
 * @typedef {{ name: string, type: 'file'|'dir', size: number, modified: string, etag?: string, mimeType?: string }} VfsStat
 */

class VfsAdapter {
  /** @param {string} userId */
  constructor(userId) {
    if (!userId || typeof userId !== 'string') {
      throw new VfsAdapterError('PERMISSION_DENIED', 'userId required');
    }
    this.userId = userId;
  }

  /** @returns {Promise<VfsEntry[]>} */
  async list(remotePath) { throw new VfsAdapterError('NOT_IMPLEMENTED', 'list'); }

  /** @returns {Promise<{ content: Buffer, mimeType: string, size: number }>} */
  async read(remotePath) { throw new VfsAdapterError('NOT_IMPLEMENTED', 'read'); }

  /**
   * @param {string} remotePath
   * @param {string|Buffer} content
   * @param {{ encoding?: string, mimeType?: string }} [opts]
   * @returns {Promise<{ size: number, etag?: string }>}
   */
  async write(remotePath, content, opts) { throw new VfsAdapterError('NOT_IMPLEMENTED', 'write'); }

  /** @returns {Promise<void>} */
  async mkdir(remotePath) { throw new VfsAdapterError('NOT_IMPLEMENTED', 'mkdir'); }

  /** @returns {Promise<void>} */
  async rm(remotePath, recursive) { throw new VfsAdapterError('NOT_IMPLEMENTED', 'rm'); }

  /** @returns {Promise<void>} */
  async mv(srcPath, dstPath) { throw new VfsAdapterError('NOT_IMPLEMENTED', 'mv'); }

  /** @returns {Promise<VfsStat>} */
  async stat(remotePath) { throw new VfsAdapterError('NOT_IMPLEMENTED', 'stat'); }
}

module.exports = { VfsAdapter, VfsAdapterError };
