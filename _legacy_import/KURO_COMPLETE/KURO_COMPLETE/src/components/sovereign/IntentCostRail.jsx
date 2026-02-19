import React, { useState, useEffect } from 'react';
import { Zap, DollarSign, Cpu } from 'lucide-react';

export default function IntentCostRail({ sessionId, model, intent }) {
  const [metrics, setMetrics] = useState(null);
  
  useEffect(() => {
    if (!sessionId) return;
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`/api/sovereign/session/${sessionId}`);
        setMetrics(await res.json());
      } catch (e) {}
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);
  
  return (
    <div className="intent-cost-rail">
      {intent && <div className="rail-item intent"><Zap size={10} /><span>{intent}</span></div>}
      {model && <div className="rail-item model"><Cpu size={10} /><span>{model.split('/').pop()?.split(':')[0]}</span></div>}
      {metrics?.requests > 0 && <>
        <div className="rail-item tokens"><span>{metrics.inputTokens + metrics.outputTokens}</span><span className="label">tok</span></div>
        <div className="rail-item cost"><DollarSign size={10} /><span>{metrics.cost?.toFixed(4)}</span></div>
      </>}
      <style>{`
        .intent-cost-rail{display:flex;align-items:center;gap:6px;padding:3px 6px;background:rgba(0,0,0,0.25);border-radius:6px;font-size:10px;color:rgba(255,255,255,0.6)}
        .rail-item{display:flex;align-items:center;gap:3px;padding:2px 5px;background:rgba(255,255,255,0.05);border-radius:4px}
        .rail-item.intent{color:#22c55e}.rail-item.model{color:#a855f7}.rail-item.cost{color:#f59e0b}.rail-item .label{opacity:.5;font-size:9px}
      `}</style>
    </div>
  );
}
