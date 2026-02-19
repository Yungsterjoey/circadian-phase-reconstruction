import React from 'react';
import { Check, Lock, AlertTriangle, FlaskConical } from 'lucide-react';

const BADGES = {
  signed: { icon: Check, color: '#22c55e', label: 'Signed' },
  sealed: { icon: Lock, color: '#3b82f6', label: 'Sealed' },
  unverified: { icon: AlertTriangle, color: '#f59e0b', label: 'Unverified' },
  draft: { icon: FlaskConical, color: '#8b5cf6', label: 'Draft' }
};

export default function AttestationBadge({ type = 'unverified', runId, onClick }) {
  const cfg = BADGES[type] || BADGES.unverified;
  const Icon = cfg.icon;
  return (
    <button className="att-badge" onClick={onClick} title={runId ? `Run: ${runId.substring(0,8)}` : ''} style={{ '--c': cfg.color }}>
      <Icon size={11} /><span>{cfg.label}</span>
      <style>{`
        .att-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:color-mix(in srgb,var(--c) 15%,transparent);border:1px solid color-mix(in srgb,var(--c) 40%,transparent);border-radius:12px;color:var(--c);font-size:10px;font-weight:600;cursor:pointer;transition:all .2s}
        .att-badge:hover{background:color-mix(in srgb,var(--c) 25%,transparent);box-shadow:0 0 8px color-mix(in srgb,var(--c) 30%,transparent)}
      `}</style>
    </button>
  );
}
