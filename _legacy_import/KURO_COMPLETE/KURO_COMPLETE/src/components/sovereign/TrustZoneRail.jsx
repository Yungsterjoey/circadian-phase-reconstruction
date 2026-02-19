import React from 'react';
import { Shield, Lock, Globe, Server } from 'lucide-react';

const ZONE_CONFIG = {
  LOCAL: { icon: Lock, color: '#22c55e', label: 'LOCAL' },
  VPS: { icon: Server, color: '#3b82f6', label: 'VPS' },
  PRIVATE: { icon: Shield, color: '#f59e0b', label: 'PRIVATE' },
  OPEN: { icon: Globe, color: '#ef4444', label: 'OPEN' }
};

export default function TrustZoneRail({ zone = 'VPS', onClick }) {
  const config = ZONE_CONFIG[zone] || ZONE_CONFIG.VPS;
  const Icon = config.icon;
  
  return (
    <button className="trust-zone-rail" onClick={onClick} style={{ '--zone-color': config.color }}>
      <Icon size={12} />
      <span>{config.label}</span>
      <style>{`
        .trust-zone-rail{display:flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--zone-color);border-radius:16px;color:var(--zone-color);font-size:10px;font-weight:600;text-transform:uppercase;cursor:pointer;transition:all .2s}
        .trust-zone-rail:hover{background:rgba(255,255,255,0.08);box-shadow:0 0 12px color-mix(in srgb,var(--zone-color) 30%,transparent)}
      `}</style>
    </button>
  );
}
