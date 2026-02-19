import React, { useState, useEffect } from 'react';
import { X, Clock, Cpu, Hash, GitBranch, Shield, RefreshCw, Copy, Check } from 'lucide-react';
import AttestationBadge from './AttestationBadge';

export default function ProvenanceOverlay({ runId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);
  
  useEffect(() => {
    if (!runId) return;
    (async () => {
      try {
        const res = await fetch(`/api/sovereign/provenance/${runId}`);
        setData(await res.json());
      } catch (e) {}
      setLoading(false);
    })();
  }, [runId]);
  
  if (!runId) return null;
  
  const getType = () => {
    if (!data?.attestation) return 'unverified';
    if (data.attestation.verified && data.attestation.sealed) return 'sealed';
    if (data.attestation.signed) return 'signed';
    return 'unverified';
  };
  
  const copy = async (t, k) => { await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(null), 2000); };
  
  return (
    <div className="prov-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="prov-panel">
        <div className="prov-header"><Shield size={16} /><span>Provenance</span><AttestationBadge type={getType()} /><button className="close-btn" onClick={onClose}><X size={14} /></button></div>
        {loading ? <div className="prov-loading"><RefreshCw size={24} className="spin" /></div> : data ? (
          <div className="prov-content">
            <div className="prov-section">
              <div className="prov-row click" onClick={() => copy(runId, 'r')}><Hash size={12} /><span className="label">Run ID</span><code>{runId.substring(0,16)}...</code>{copied === 'r' ? <Check size={12} className="ok" /> : <Copy size={12} className="cp" />}</div>
              <div className="prov-row"><Cpu size={12} /><span className="label">Model</span><span>{data.capsule?.config?.model}</span></div>
              <div className="prov-row"><Clock size={12} /><span className="label">Duration</span><span>{data.capsule?.metrics?.duration}ms</span></div>
              {data.capsule?.git?.available && <div className="prov-row click" onClick={() => copy(data.capsule.git.commit, 'g')}><GitBranch size={12} /><span className="label">Git</span><code>{data.capsule.git.commit?.substring(0,8)}</code>{data.capsule.git.dirty && <span className="dirty">dirty</span>}</div>}
            </div>
            <div className="prov-section"><div className="sec-title">Hashes</div><div className="hash-row"><span>In</span><code>{data.capsule?.inputHashes?.[0]?.substring(0,20)}...</code></div><div className="hash-row"><span>Out</span><code>{data.capsule?.outputHashes?.[0]?.substring(0,20)}...</code></div></div>
            <div className="prov-section"><div className="sec-title">Metrics</div><div className="metrics"><div className="m"><span className="mv">{data.capsule?.metrics?.totalTokens||0}</span><span className="ml">Tokens</span></div><div className="m"><span className="mv">${(data.capsule?.metrics?.cost||0).toFixed(4)}</span><span className="ml">Cost</span></div><div className="m"><span className="mv">{data.trustZone||'VPS'}</span><span className="ml">Zone</span></div></div></div>
          </div>
        ) : <div className="prov-error">Not found</div>}
      </div>
      <style>{`
        .prov-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:10000}
        .prov-panel{width:380px;max-height:85vh;background:rgba(18,18,24,0.98);border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.6)}
        .prov-header{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(180deg,rgba(168,85,247,0.12) 0%,rgba(168,85,247,0.02) 100%);border-bottom:1px solid rgba(255,255,255,0.06);font-weight:600;color:#fff}
        .prov-header .close-btn{margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;padding:4px;border-radius:6px}.prov-header .close-btn:hover{background:rgba(255,255,255,0.1)}
        .prov-content{padding:12px 16px;overflow-y:auto;max-height:calc(85vh - 60px)}
        .prov-section{padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05)}.prov-section:last-child{border-bottom:none}
        .sec-title{font-size:10px;font-weight:600;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:10px}
        .prov-row{display:flex;align-items:center;gap:8px;padding:8px 0;font-size:12px;color:rgba(255,255,255,0.7)}
        .prov-row.click{cursor:pointer;border-radius:6px;margin:0 -8px;padding:8px}.prov-row.click:hover{background:rgba(255,255,255,0.04)}
        .prov-row .label{color:rgba(255,255,255,0.4);min-width:60px}
        .prov-row code{font-family:'JetBrains Mono',monospace;font-size:11px;color:#a855f7}
        .prov-row .dirty{padding:1px 5px;background:rgba(245,158,11,0.2);color:#f59e0b;border-radius:4px;font-size:9px}
        .prov-row .cp{margin-left:auto;opacity:.3}.prov-row:hover .cp{opacity:.7}.prov-row .ok{margin-left:auto;color:#22c55e}
        .hash-row{display:flex;justify-content:space-between;padding:6px 0;font-size:11px}.hash-row span{color:rgba(255,255,255,0.4)}.hash-row code{font-family:monospace;color:#22c55e;font-size:10px}
        .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.m{text-align:center;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px}.mv{display:block;font-size:14px;font-weight:600;color:#fff}.ml{display:block;font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-top:2px}
        .prov-loading,.prov-error{padding:50px;text-align:center;color:rgba(255,255,255,0.4)}.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  );
}
