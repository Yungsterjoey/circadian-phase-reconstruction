/**
 * KURO VFS Snapshot v1.0
 *
 * Downloads a user's project prefix from S3 into a temp directory on the
 * server, which the runner sidecar mounts as a read-only workspace.
 *
 * createSnapshot(userId, projectId, jobId)
 *   → { snapshotId, snapshotDir }
 *
 * materializeSnapshot(userId, projectId, jobId)
 *   → { snapshotId, snapshotDir }
 *   (alias — same as createSnapshot; kept for clarity at call site)
 *
 * Env:
 *   VFS_S3_BUCKET, VFS_S3_REGION, VFS_S3_ENDPOINT,
 *   VFS_S3_ACCESS_KEY_ID, VFS_S3_SECRET_ACCESS_KEY
 *   KURO_DATA  — root data dir (snapshots land in $KURO_DATA/snapshots/)
 *
 * If S3 is not configured, returns a clean empty workspace dir (no error).
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR      = process.env.KURO_DATA || '/var/lib/kuro';
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');

const BUCKET = process.env.VFS_S3_BUCKET;
const REGION = process.env.VFS_S3_REGION || 'us-east-1';

// Max files / size to download into a snapshot (safety limits)
const MAX_SNAPSHOT_FILES = parseInt(process.env.SNAPSHOT_MAX_FILES || '500', 10);
const MAX_SNAPSHOT_BYTES = parseInt(process.env.SNAPSHOT_MAX_BYTES || String(100 * 1024 * 1024), 10); // 100 MB

let S3Client, GetObjectCommand, ListObjectsV2Command;
try {
  ({ S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3'));
} catch {
  /* SDK not installed — S3 features will be skipped */
}

let _client = null;
function getClient() {
  if (!_client) {
    if (!S3Client) throw new Error('@aws-sdk/client-s3 not installed');
    if (!BUCKET)   throw new Error('VFS_S3_BUCKET not set');
    const cfg = { region: REGION };
    if (process.env.VFS_S3_ENDPOINT) { cfg.endpoint = process.env.VFS_S3_ENDPOINT; cfg.forcePathStyle = true; }
    if (process.env.VFS_S3_ACCESS_KEY_ID) {
      cfg.credentials = {
        accessKeyId:     process.env.VFS_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.VFS_S3_SECRET_ACCESS_KEY || '',
      };
    }
    _client = new S3Client(cfg);
  }
  return _client;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c instanceof Buffer ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

/**
 * Download all objects under S3 prefix into a local directory.
 * @param {string} s3Prefix  e.g. "users/abc/projects/xyz/"
 * @param {string} localDir  destination directory (created if absent)
 */
async function downloadPrefix(s3Prefix, localDir) {
  const client = getClient();
  let token;
  let fileCount = 0;
  let totalBytes = 0;

  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: s3Prefix, ContinuationToken: token,
    }));

    for (const obj of res.Contents || []) {
      if (fileCount >= MAX_SNAPSHOT_FILES) {
        console.warn(`[SNAPSHOT] File limit (${MAX_SNAPSHOT_FILES}) reached; skipping remaining`);
        return;
      }
      if (totalBytes + (obj.Size || 0) > MAX_SNAPSHOT_BYTES) {
        console.warn(`[SNAPSHOT] Size limit (${MAX_SNAPSHOT_BYTES} bytes) reached; skipping remaining`);
        return;
      }

      // Relative path within snapshot
      const rel = obj.Key.slice(s3Prefix.length);
      if (!rel || rel.endsWith('/')) continue; // skip dir markers

      // Strip traversal
      const safeParts = rel.split('/').map(p => p.replace(/\.\./g, '_'));
      const localPath = path.join(localDir, ...safeParts);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });

      const objRes = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      const buf = await streamToBuffer(objRes.Body);
      fs.writeFileSync(localPath, buf);
      fileCount++;
      totalBytes += buf.length;
    }

    token = res.IsTruncated ? res.NextContinuationToken : null;
  } while (token);

  console.log(`[SNAPSHOT] Downloaded ${fileCount} files (${totalBytes} bytes) from ${s3Prefix}`);
}

/**
 * Materialize a project snapshot from VFS (S3) into a local temp directory.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} jobId  — used as subdirectory name under snapshots/
 * @returns {{ snapshotId: string, snapshotDir: string }}
 */
async function materializeSnapshot(userId, projectId, jobId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');

  const snapshotId  = jobId || require('crypto').randomBytes(16).toString('hex');
  const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotId, 'workspace');
  fs.mkdirSync(snapshotDir, { recursive: true });

  if (!BUCKET || !S3Client) {
    console.warn('[SNAPSHOT] S3 not configured — returning empty workspace');
    return { snapshotId, snapshotDir };
  }

  const s3Prefix = projectId
    ? `users/${userId}/projects/${projectId}/`
    : `users/${userId}/`;

  try {
    await downloadPrefix(s3Prefix, snapshotDir);
  } catch (e) {
    console.warn(`[SNAPSHOT] Download failed (${e.message}); workspace will be empty`);
  }

  return { snapshotId, snapshotDir };
}

// Alias for call-site clarity
const createSnapshot = materializeSnapshot;

module.exports = { materializeSnapshot, createSnapshot };
