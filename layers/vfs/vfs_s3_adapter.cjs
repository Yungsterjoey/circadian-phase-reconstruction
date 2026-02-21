/**
 * KURO VFS S3 Adapter v1.0
 * Primary VFS backend. Per-user namespace: users/{userId}/
 *
 * Required env:
 *   VFS_S3_BUCKET              — S3 bucket name
 *
 * Optional env:
 *   VFS_S3_REGION              — default: us-east-1
 *   VFS_S3_ENDPOINT            — custom endpoint (MinIO, Cloudflare R2, etc.)
 *   VFS_S3_ACCESS_KEY_ID       — explicit credentials (uses IAM role if absent)
 *   VFS_S3_SECRET_ACCESS_KEY
 */

const { VfsAdapter, VfsAdapterError } = require('./vfs_adapter.interface.cjs');

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
    ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand;

try {
  ({ S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
     ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3'));
} catch {
  console.error('[VFS:S3] @aws-sdk/client-s3 not installed. Run: npm install @aws-sdk/client-s3');
}

const BUCKET = process.env.VFS_S3_BUCKET;
const REGION = process.env.VFS_S3_REGION || 'us-east-1';

let _client = null;

function getClient() {
  if (!S3Client) throw new VfsAdapterError('IO_ERROR', '@aws-sdk/client-s3 not installed');
  if (!BUCKET)   throw new VfsAdapterError('IO_ERROR', 'VFS_S3_BUCKET env var not set');
  if (_client) return _client;

  const cfg = { region: REGION };
  if (process.env.VFS_S3_ENDPOINT) {
    cfg.endpoint = process.env.VFS_S3_ENDPOINT;
    cfg.forcePathStyle = true; // required for MinIO
  }
  if (process.env.VFS_S3_ACCESS_KEY_ID) {
    cfg.credentials = {
      accessKeyId:     process.env.VFS_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.VFS_S3_SECRET_ACCESS_KEY || '',
    };
  }
  _client = new S3Client(cfg);
  return _client;
}

// Strip path traversal and normalize
function sanitizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return p
    .replace(/\\/g, '/')
    .replace(/\.\.[/\\]/g, '_')    // ../../ → _/
    .replace(/\.\.$/, '_')         // trailing ..
    .replace(/^\/+/, '')           // no leading slash
    .replace(/\/\/+/g, '/');       // collapse doubles
}

// Build S3 object key: users/{userId}/{sanitized-path}
function makeKey(userId, remotePath) {
  const safe = sanitizePath(remotePath || '');
  const key  = `users/${userId}/${safe}`;
  return key.replace(/\/$/, ''); // no trailing slash for files
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

class S3VfsAdapter extends VfsAdapter {
  constructor(userId) {
    super(userId);
    this._userPrefix = `users/${userId}/`;
  }

  async list(remotePath) {
    const client = getClient();
    const dirKey = makeKey(this.userId, remotePath || '');
    const prefix = dirKey ? dirKey + '/' : this._userPrefix;

    let result;
    try {
      result = await client.send(new ListObjectsV2Command({
        Bucket: BUCKET, Prefix: prefix, Delimiter: '/',
      }));
    } catch (e) {
      throw new VfsAdapterError('IO_ERROR', `S3 list failed: ${e.message}`);
    }

    const entries = [];

    for (const cp of result.CommonPrefixes || []) {
      const name = cp.Prefix.slice(prefix.length).replace(/\/$/, '');
      if (name) entries.push({ name, type: 'dir', size: 0, modified: '' });
    }

    for (const obj of result.Contents || []) {
      const name = obj.Key.slice(prefix.length);
      if (!name || name.includes('/')) continue; // skip nested keys or dir markers
      if (name.endsWith('/')) continue;
      entries.push({
        name,
        type:     'file',
        size:     obj.Size || 0,
        modified: obj.LastModified ? obj.LastModified.toISOString() : '',
      });
    }

    return entries;
  }

  async read(remotePath) {
    const client = getClient();
    const key    = makeKey(this.userId, remotePath);

    let result;
    try {
      result = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
        throw new VfsAdapterError('NOT_FOUND', `Not found: ${remotePath}`);
      }
      throw new VfsAdapterError('IO_ERROR', `S3 read failed: ${e.message}`);
    }

    const content = await streamToBuffer(result.Body);
    return {
      content,
      mimeType: result.ContentType || 'application/octet-stream',
      size:     result.ContentLength || content.length,
    };
  }

  async write(remotePath, content, opts = {}) {
    const client = getClient();
    const key    = makeKey(this.userId, remotePath);
    const body   = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, opts.encoding || 'utf8');
    const mimeType = opts.mimeType || 'application/octet-stream';

    try {
      const result = await client.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: body,
        ContentType: mimeType, ContentLength: body.length,
      }));
      return { size: body.length, etag: result.ETag };
    } catch (e) {
      throw new VfsAdapterError('IO_ERROR', `S3 write failed: ${e.message}`);
    }
  }

  async mkdir(remotePath) {
    // S3 is flat — store an empty directory marker key ending with /
    const client = getClient();
    const key    = makeKey(this.userId, remotePath) + '/';
    try {
      await client.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: Buffer.alloc(0), ContentLength: 0,
      }));
    } catch (e) {
      throw new VfsAdapterError('IO_ERROR', `S3 mkdir failed: ${e.message}`);
    }
  }

  async rm(remotePath, recursive = false) {
    const client = getClient();
    const key    = makeKey(this.userId, remotePath);

    if (recursive) {
      const prefix = key + '/';
      let token;
      do {
        const res = await client.send(new ListObjectsV2Command({
          Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
        }));
        const keys = (res.Contents || []).map(o => o.Key);
        keys.push(key, key + '/'); // also remove the key itself + dir marker
        for (const k of keys) {
          try { await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k })); }
          catch { /* ignore individual miss */ }
        }
        token = res.IsTruncated ? res.NextContinuationToken : null;
      } while (token);
      return;
    }

    try {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (e) {
      throw new VfsAdapterError('IO_ERROR', `S3 rm failed: ${e.message}`);
    }
  }

  async mv(srcPath, dstPath) {
    const client = getClient();
    const srcKey = makeKey(this.userId, srcPath);
    const dstKey = makeKey(this.userId, dstPath);

    try {
      await client.send(new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${srcKey}`,
        Key: dstKey,
      }));
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: srcKey }));
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
        throw new VfsAdapterError('NOT_FOUND', `Not found: ${srcPath}`);
      }
      throw new VfsAdapterError('IO_ERROR', `S3 mv failed: ${e.message}`);
    }
  }

  async stat(remotePath) {
    const client = getClient();
    const key    = makeKey(this.userId, remotePath);

    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return {
        name:     remotePath.split('/').pop() || remotePath,
        type:     'file',
        size:     result.ContentLength || 0,
        modified: result.LastModified ? result.LastModified.toISOString() : '',
        etag:     result.ETag || '',
        mimeType: result.ContentType || 'application/octet-stream',
      };
    } catch (e) {
      // Try as directory (check for any objects under prefix)
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
        try {
          const prefix = key + '/';
          const res = await client.send(new ListObjectsV2Command({
            Bucket: BUCKET, Prefix: prefix, MaxKeys: 1,
          }));
          if ((res.Contents || []).length > 0 || (res.CommonPrefixes || []).length > 0) {
            return {
              name: remotePath.split('/').pop() || '/',
              type: 'dir', size: 0, modified: '',
            };
          }
        } catch { /* fall through */ }
        throw new VfsAdapterError('NOT_FOUND', `Not found: ${remotePath}`);
      }
      throw new VfsAdapterError('IO_ERROR', `S3 stat failed: ${e.message}`);
    }
  }
}

module.exports = { S3VfsAdapter };
