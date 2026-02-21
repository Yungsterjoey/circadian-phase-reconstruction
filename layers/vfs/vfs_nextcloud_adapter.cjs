/**
 * KURO VFS Nextcloud Adapter v0.1 — STUB
 *
 * Not yet implemented. All methods throw NOT_IMPLEMENTED.
 * Future: WebDAV via NEXTCLOUD_URL / NEXTCLOUD_USER / NEXTCLOUD_PASSWORD.
 */

const { VfsAdapter, VfsAdapterError } = require('./vfs_adapter.interface.cjs');

const NOT_IMPL = () => { throw new VfsAdapterError('NOT_IMPLEMENTED', 'Nextcloud adapter not yet implemented'); };

class NextcloudVfsAdapter extends VfsAdapter {
  constructor(userId) {
    super(userId);
    // Future: this._base = `${process.env.NEXTCLOUD_URL}/remote.php/dav/files/${process.env.NEXTCLOUD_USER}/kuro/${userId}/`;
  }

  async list(p)     { NOT_IMPL(); }
  async read(p)     { NOT_IMPL(); }
  async write(p, c) { NOT_IMPL(); }
  async mkdir(p)    { NOT_IMPL(); }
  async rm(p, r)    { NOT_IMPL(); }
  async mv(s, d)    { NOT_IMPL(); }
  async stat(p)     { NOT_IMPL(); }
}

module.exports = { NextcloudVfsAdapter };
