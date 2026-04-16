-- KURO x402 Facilitator — additive schema (CLAUDE.md §3 compliant)
-- Applied via better-sqlite3 on module init. Never drops, never alters.

CREATE TABLE IF NOT EXISTS kuro_facilitator_events (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  kind            TEXT NOT NULL,              -- 'verify' | 'settle'
  scheme          TEXT NOT NULL,              -- 'exact-evm-base' | 'exact-svm-solana' | 'fiat-napas247' | ...
  idempotency_key TEXT,                       -- settle only; unique when present
  payer           TEXT,                       -- address or merchant id
  network         TEXT,                       -- 'base' | 'solana' | 'napas247' | ...
  amount          TEXT,                       -- string to preserve precision
  currency        TEXT,
  tx_ref          TEXT,                       -- chain tx hash or rail reference
  status          TEXT NOT NULL DEFAULT 'ok', -- 'ok' | 'rejected' | 'error'
  reason          TEXT,                       -- invalidReason on reject / error message
  payload_hash    TEXT,                       -- sha256 of payload for audit
  request_ts      INTEGER,                    -- payload.ts from the request
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_facilitator_idempotency
  ON kuro_facilitator_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_facilitator_kind_scheme
  ON kuro_facilitator_events(kind, scheme);

CREATE INDEX IF NOT EXISTS ix_facilitator_created
  ON kuro_facilitator_events(created_at);

CREATE TABLE IF NOT EXISTS kuro_facilitator_nonces (
  nonce       TEXT PRIMARY KEY,
  scheme      TEXT NOT NULL,
  seen_at     INTEGER NOT NULL,           -- unix seconds
  expires_at  INTEGER NOT NULL            -- unix seconds, seen_at + TTL
);

CREATE INDEX IF NOT EXISTS ix_facilitator_nonces_expires
  ON kuro_facilitator_nonces(expires_at);
