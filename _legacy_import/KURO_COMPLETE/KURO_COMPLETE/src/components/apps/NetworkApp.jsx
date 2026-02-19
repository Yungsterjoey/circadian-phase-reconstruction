import React, { useState, useEffect } from 'react';
import { Shield, Globe, Activity, Server, Wifi, Power, Lock, AlertTriangle } from 'lucide-react';
import './NetworkApp.css';

export default function NetworkApp() {
  const [activeTab, setActiveTab] = useState('vpn');
  const [vpnStatus, setVpnStatus] = useState({});
  const [dnsStats, setDnsStats] = useState({});

  useEffect(() => {
    fetch('/api/network/dns/stats').then(r=>r.json()).then(setDnsStats).catch(()=>{});
    fetch('/api/network/vpn/status').then(r=>r.json()).then(setVpnStatus).catch(()=>{});
  }, []);

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100%', color:'#fff'}}>
      <div style={{display:'flex', gap:20, padding:10, background:'rgba(0,0,0,0.2)', fontSize:11, fontFamily:'monospace'}}>
        <span>VPN: {vpnStatus.active ? 'CONNECTED' : 'EXPOSED'}</span>
        <span>DNS: {dnsStats.blocked ? 'SECURE' : 'STANDARD'}</span>
      </div>
      <div style={{flex:1, display:'flex'}}>
        <div style={{width:160, background:'rgba(255,255,255,0.02)', padding:10}}>
          <button onClick={()=>setActiveTab('vpn')} style={{display:'block', width:'100%', textAlign:'left', padding:10, color:activeTab==='vpn'?'#a855f7':'#888', background:'transparent', border:'none'}}>VPN</button>
          <button onClick={()=>setActiveTab('dns')} style={{display:'block', width:'100%', textAlign:'left', padding:10, color:activeTab==='dns'?'#a855f7':'#888', background:'transparent', border:'none'}}>DNS</button>
        </div>
        <div style={{flex:1, padding:20}}>
          {activeTab === 'vpn' && (
            <div className="glass-card" style={{padding:20, border:'1px solid rgba(255,255,255,0.1)', borderRadius:12}}>
              <h3>KURO VPN</h3>
              <div style={{display:'flex', alignItems:'center', gap:10, margin:'20px 0'}}>
                <div style={{flex:1, height:2, background:vpnStatus.active?'#4ade80':'#333'}}></div>
                {vpnStatus.active ? <Lock size={20} color="#4ade80"/> : <AlertTriangle size={20} color="#666"/>}
                <div style={{flex:1, height:2, background:vpnStatus.active?'#4ade80':'#333'}}></div>
              </div>
              <button style={{width:'100%', padding:12, background:vpnStatus.active?'#f87171':'#4ade80', border:'none', borderRadius:8, fontWeight:'bold'}} onClick={() => fetch('/api/network/vpn/toggle', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:vpnStatus.active?'down':'up'})}).then(()=>window.location.reload())}>
                {vpnStatus.active ? 'DISCONNECT' : 'CONNECT'}
              </button>
            </div>
          )}
          {activeTab === 'dns' && (
             <div className="glass-card" style={{padding:20}}>
               <h3>IRON DOME</h3>
               <div style={{fontSize:32, fontWeight:'bold'}}>{dnsStats.queries?.toLocaleString() || 0}</div>
               <div style={{color:'#666'}}>QUERIES SCANNED</div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
