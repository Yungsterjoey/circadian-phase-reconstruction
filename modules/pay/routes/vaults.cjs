'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();

const ledger = require('../core/ledger.cjs');
const audit = require('../core/audit.cjs');
const events = require('../core/events.cjs');

// ═══ VAULTS ═══════════════════════════════════════════════════════════

// GET /vaults
router.get('/', (req, res) => {
  try {
    res.json({ ok: true, vaults: ledger.getVaults() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /vaults — create vault
router.post('/', (req, res) => {
  try {
    const { name, emoji, currency, goal_minor, colour } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = randomUUID();
    ledger.insertVault({ id, name, emoji: emoji || '💰', currency: currency || 'AUD', goal_minor: goal_minor || 0, colour: colour || '#a855f7' });
    audit.inscribe('vault_create', null, 'user');
    res.json({ ok: true, vault: ledger.getVault(id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /vaults/:id — update vault metadata
router.patch('/:id', (req, res) => {
  try {
    const vault = ledger.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: 'not found' });
    const allowed = ['name', 'emoji', 'currency', 'goal_minor', 'colour'];
    const updates = {};
    for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'no updates' });
    res.json({ ok: true, vault: ledger.updateVault(req.params.id, updates) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /vaults/:id
router.delete('/:id', (req, res) => {
  try {
    const vault = ledger.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: 'not found' });
    // If vault has balance, return to main
    if (vault.current_minor > 0) {
      const lid = ledger.insertLedger({
        type: 'vault_withdraw', amount_minor: vault.current_minor,
        currency: vault.currency, from_ref: `vault:${vault.name}`, to_ref: 'main',
        status: 'completed', ai_memo: `Vault closed: ${vault.name}`,
        metadata: JSON.stringify({ vault_id: vault.id }),
      });
      audit.inscribe('vault_close_withdraw', lid, 'user');
    }
    ledger.deleteVault(req.params.id);
    audit.inscribe('vault_delete', null, 'user');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /vaults/:id/deposit — move funds from main balance into vault
router.post('/:id/deposit', (req, res) => {
  try {
    const vault = ledger.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: 'vault not found' });
    const { amount_minor } = req.body || {};
    if (!amount_minor || amount_minor <= 0) return res.status(400).json({ error: 'amount_minor required (positive integer)' });

    // Update vault balance
    ledger.updateVault(vault.id, { current_minor: vault.current_minor + amount_minor });

    // Create ledger entry
    const lid = ledger.insertLedger({
      type: 'vault_deposit', amount_minor,
      currency: vault.currency, from_ref: 'main', to_ref: `vault:${vault.name}`,
      status: 'completed', ai_memo: `Saved to ${vault.name}`,
      metadata: JSON.stringify({ vault_id: vault.id }),
    });

    audit.inscribe('vault_deposit', lid, 'user');
    events.emit('transaction', { type: 'vault_deposit', vault_id: vault.id, amount_minor });

    res.json({ ok: true, vault: ledger.getVault(vault.id), ledger_id: lid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /vaults/:id/withdraw — move funds from vault back to main balance
router.post('/:id/withdraw', (req, res) => {
  try {
    const vault = ledger.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: 'vault not found' });
    const { amount_minor } = req.body || {};
    if (!amount_minor || amount_minor <= 0) return res.status(400).json({ error: 'amount_minor required (positive integer)' });
    if (amount_minor > vault.current_minor) return res.status(400).json({ error: 'insufficient vault balance' });

    // Update vault balance
    ledger.updateVault(vault.id, { current_minor: vault.current_minor - amount_minor });

    // Create ledger entry
    const lid = ledger.insertLedger({
      type: 'vault_withdraw', amount_minor,
      currency: vault.currency, from_ref: `vault:${vault.name}`, to_ref: 'main',
      status: 'completed', ai_memo: `Withdrew from ${vault.name}`,
      metadata: JSON.stringify({ vault_id: vault.id }),
    });

    audit.inscribe('vault_withdraw', lid, 'user');
    events.emit('transaction', { type: 'vault_withdraw', vault_id: vault.id, amount_minor });

    res.json({ ok: true, vault: ledger.getVault(vault.id), ledger_id: lid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /round-up-stack — queue spare cents for BTC conversion
router.post('/round-up-stack', (req, res) => {
  try {
    const pending = ledger.getPendingRoundUps();
    const totalPending = pending.reduce((s, r) => s + r.amount_cents, 0);
    const spareCents = Math.floor(Math.random() * 99) + 1;
    const entry = ledger.insertRoundUp(spareCents);
    res.json({
      ok: true, queued_cents: spareCents,
      total_pending_cents: totalPending + spareCents,
      pending_count: pending.length + 1,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══ PAYEES ═══════════════════════════════════════════════════════════

// GET /payees
router.get('/payees', (req, res) => {
  try {
    res.json({ ok: true, payees: ledger.getPayees() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /payees — create payee
router.post('/payees', (req, res) => {
  try {
    const { name, type, bsb, account_number, payid, crypto_address, currency, favourite } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!type || !['bsb', 'payid', 'xmr', 'btc'].includes(type)) {
      return res.status(400).json({ error: 'type must be bsb|payid|xmr|btc' });
    }
    // Validate based on type
    if (type === 'bsb' && (!bsb || !account_number)) return res.status(400).json({ error: 'bsb and account_number required' });
    if (type === 'payid' && !payid) return res.status(400).json({ error: 'payid required' });
    if (type === 'xmr' && !crypto_address) return res.status(400).json({ error: 'crypto_address required for XMR' });
    if (type === 'btc' && !crypto_address) return res.status(400).json({ error: 'crypto_address required for BTC' });

    const payee = ledger.insertPayee({ name, type, bsb, account_number, payid, crypto_address, currency: currency || (type === 'xmr' ? 'XMR' : type === 'btc' ? 'BTC' : 'AUD'), favourite: favourite ? 1 : 0 });
    res.json({ ok: true, payee });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /payees/:id — update payee
router.patch('/payees/:id', (req, res) => {
  try {
    const payee = ledger.getPayee(req.params.id);
    if (!payee) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, payee: ledger.updatePayee(req.params.id, req.body) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /payees/:id
router.delete('/payees/:id', (req, res) => {
  try {
    const payee = ledger.getPayee(req.params.id);
    if (!payee) return res.status(404).json({ error: 'not found' });
    ledger.deletePayee(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /payees/:id/favourite — toggle favourite
router.post('/payees/:id/favourite', (req, res) => {
  try {
    const payee = ledger.getPayee(req.params.id);
    if (!payee) return res.status(404).json({ error: 'not found' });
    const updated = ledger.updatePayee(req.params.id, { favourite: payee.favourite ? 0 : 1 });
    res.json({ ok: true, payee: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
