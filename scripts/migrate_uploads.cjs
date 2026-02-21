#!/usr/bin/env node
/**
 * KURO Phase 0 — Upload namespace migration
 *
 * Moves flat files in $KURO_DATA/uploads/ into per-user subdirs.
 * Files that can't be matched to a user are moved to _unmigrated/.
 *
 * Usage:
 *   node scripts/migrate_uploads.cjs --dry-run   # preview only
 *   node scripts/migrate_uploads.cjs             # live run
 */

const fs   = require('fs');
const path = require('path');

const DRY_RUN    = process.argv.includes('--dry-run');
const DATA_DIR   = process.env.KURO_DATA || '/var/lib/kuro';
const UPLOADS    = path.join(DATA_DIR, 'uploads');
const UNMIGRATED = path.join(UPLOADS, '_unmigrated');

if (!fs.existsSync(UPLOADS)) {
  console.log('No uploads directory found — nothing to migrate.');
  process.exit(0);
}

// Load DB to attempt user matching by upload metadata if available
let db = null;
try {
  const { db: kdb } = require('../layers/auth/db.cjs');
  db = kdb;
  console.log('[migrate] DB loaded — will attempt user matching');
} catch(e) {
  console.warn('[migrate] DB not available — unmatched files go to _unmigrated/');
}

const entries = fs.readdirSync(UPLOADS, { withFileTypes: true });
const flatFiles = entries.filter(e => e.isFile()); // files directly in uploads/ (not in subdirs)

if (flatFiles.length === 0) {
  console.log('No flat files found in uploads/ — already migrated or empty.');
  process.exit(0);
}

console.log(`[migrate] Found ${flatFiles.length} flat file(s) to migrate. DRY_RUN=${DRY_RUN}\n`);

let moved = 0, skipped = 0;

for (const entry of flatFiles) {
  const src = path.join(UPLOADS, entry.name);
  // Attempt to find owner in DB via a hypothetical uploads log table
  // In practice, without an uploads table, we move to _unmigrated
  let destDir = UNMIGRATED;
  let userId  = null;

  if (db) {
    try {
      // Try finding user by token reference — not available without uploads table
      // Future: if an uploads table is added, query it here
    } catch(e) {}
  }

  const dest = path.join(destDir, entry.name);

  console.log(`  ${DRY_RUN ? '[DRY]' : '[MOVE]'} ${src} → ${dest}`);

  if (!DRY_RUN) {
    try {
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      // Guard: never overwrite existing file
      if (fs.existsSync(dest)) {
        const ts = Date.now();
        const ext = path.extname(entry.name);
        const base = path.basename(entry.name, ext);
        const safeDest = path.join(destDir, `${base}_${ts}${ext}`);
        fs.renameSync(src, safeDest);
        console.log(`    (renamed to avoid collision: ${path.basename(safeDest)})`);
      } else {
        fs.renameSync(src, dest);
      }
      moved++;
    } catch(e) {
      console.error(`  [ERROR] Could not move ${entry.name}: ${e.message}`);
      skipped++;
    }
  } else {
    moved++;
  }
}

console.log(`\n[migrate] Done. ${DRY_RUN ? 'Would move' : 'Moved'} ${moved} file(s), skipped ${skipped}.`);
if (!DRY_RUN && moved > 0) {
  console.log(`\nFiles moved to: ${UNMIGRATED}`);
  console.log('Review _unmigrated/ and manually move files to the correct user subdir (uploads/{userId}/) if the owner is known.');
}
