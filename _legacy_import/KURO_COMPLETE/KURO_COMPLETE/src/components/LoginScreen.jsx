import React, { useState } from 'react';
import { Lock, Cpu, ShieldCheck } from 'lucide-react';
import { useOSStore } from '../stores/osStore';

export default function LoginScreen() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuthenticated = useOSStore((state) => state.setAuthenticated);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // FORCE RELATIVE PATH - This uses the domain you are currently on
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      if (!res.ok) throw new Error(`Server Error: ${res.status}`);
      
      const data = await res.json();
      
      if (data.valid) {
        setAuthenticated(true);
      } else {
        setError('Access Denied: Invalid Token');
      }
    } catch (err) {
      console.error(err);
      setError('Connection Failed. Check Nginx/Backend.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="icon-wrapper">
          <Cpu size={48} color="#a855f7" />
        </div>
        <h1>KURO OS <span className="version">v2.0</span></h1>
        <p className="status">Sovereign Node Online</p>
        
        <form onSubmit={handleLogin}>
          <div className="input-group">
            <Lock size={16} className="input-icon" />
            <input 
              type="password" 
              placeholder="Enter Access Token" 
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Authenticating...' : 'Initialize System'}
          </button>
        </form>
        
        {error && <div className="error-msg"><ShieldCheck size={14}/> {error}</div>}
      </div>

      <style>{`
        .login-screen { height: 100vh; width: 100vw; background: #050508; display: flex; align-items: center; justify-content: center; color: white; font-family: 'Inter', sans-serif; }
        .login-card { background: rgba(255,255,255,0.03); padding: 40px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.08); width: 100%; max-width: 360px; text-align: center; backdrop-filter: blur(20px); }
        .icon-wrapper { background: rgba(168, 85, 247, 0.1); width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 0 30px rgba(168, 85, 247, 0.2); }
        h1 { font-size: 24px; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.5px; }
        .version { font-size: 12px; background: #222; padding: 2px 6px; border-radius: 4px; color: #888; vertical-align: middle; }
        .status { color: #4ade80; font-size: 13px; font-weight: 500; margin-bottom: 30px; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .status::before { content: ''; display: block; width: 6px; height: 6px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 8px #4ade80; }
        .input-group { position: relative; margin-bottom: 16px; }
        .input-icon { position: absolute; left: 14px; top: 14px; color: #666; }
        input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 12px 12px 12px 40px; border-radius: 10px; color: white; outline: none; transition: all 0.2s; box-sizing: border-box; }
        input:focus { border-color: #a855f7; background: rgba(0,0,0,0.5); }
        button { width: 100%; background: #a855f7; color: white; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        button:hover { background: #9333ea; box-shadow: 0 0 20px rgba(168, 85, 247, 0.4); }
        button:disabled { opacity: 0.7; cursor: not-allowed; }
        .error-msg { margin-top: 16px; color: #f87171; font-size: 13px; background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; }
      `}</style>
    </div>
  );
}
