/**
 * KURO FileExplorerApp v1.0
 * Minimal VFS file browser: list, navigate, mkdir, text-upload, delete.
 * Backend: /api/vfs/*
 */

import React, { useState, useEffect, useCallback } from 'react';

const API = '/api/vfs';

async function apiFetch(url, opts = {}) {
  const r = await fetch(url, { credentials: 'include', ...opts });
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(body.error || r.statusText);
  }
  return r.json();
}

function fmtSize(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}

const S = {
  root:    { display:'flex', flexDirection:'column', height:'100%', background:'rgba(10,10,20,0.95)', color:'rgba(255,255,255,0.88)', fontFamily:'monospace', fontSize:13 },
  toolbar: { display:'flex', alignItems:'center', gap:6, padding:'9px 12px', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 },
  pathBar: { flex:1, color:'rgba(255,255,255,0.4)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12 },
  btn:     { background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'rgba(255,255,255,0.7)', cursor:'pointer', padding:'4px 10px', fontSize:12 },
  input:   { flex:1, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:6, padding:'4px 8px', color:'rgba(255,255,255,0.88)', fontSize:13 },
  row:     { display:'flex', alignItems:'center', padding:'6px 12px', borderBottom:'1px solid rgba(255,255,255,0.04)' },
  name:    { flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  meta:    { color:'rgba(255,255,255,0.3)', fontSize:11, marginRight:10, whiteSpace:'nowrap' },
  err:     { padding:'8px 12px', background:'rgba(255,50,50,0.1)', color:'#ff6060', fontSize:12, flexShrink:0 },
  empty:   { padding:'24px 12px', color:'rgba(255,255,255,0.25)', textAlign:'center' },
  quota:   { padding:'7px 12px', borderTop:'1px solid rgba(255,255,255,0.06)', flexShrink:0, fontSize:11, color:'rgba(255,255,255,0.3)' },
};

export default function FileExplorerApp() {
  const [path,        setPath]        = useState('/');
  const [entries,     setEntries]     = useState([]);
  const [quota,       setQuota]       = useState(null);
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [newDir,      setNewDir]      = useState('');
  const [showMkdir,   setShowMkdir]   = useState(false);

  const normPath = (p) => ('/' + p).replace(/\/\/+/g, '/').replace(/\/$/, '') || '/';

  const load = useCallback(async (p) => {
    const target = p ?? path;
    setLoading(true); setError('');
    try {
      const [list, q] = await Promise.all([
        apiFetch(`${API}/list?path=${encodeURIComponent(target)}`),
        apiFetch(`${API}/quota`),
      ]);
      setEntries(list.entries || []);
      setQuota(q);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { load('/'); }, []);

  const navigate = (dir) => {
    const next = normPath((path === '/' ? '' : path) + '/' + dir);
    setPath(next);
    load(next);
  };

  const goUp = () => {
    const parts = path.split('/').filter(Boolean);
    const up = parts.length > 0 ? '/' + parts.slice(0, -1).join('/') : '/';
    setPath(up);
    load(up);
  };

  const doMkdir = async () => {
    const name = newDir.trim();
    if (!name) return;
    const full = normPath((path === '/' ? '' : path) + '/' + name);
    try {
      await apiFetch(`${API}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: full }),
      });
      setNewDir(''); setShowMkdir(false);
      load();
    } catch (e) { setError(e.message); }
  };

  const doDelete = async (name, type) => {
    if (!confirm(`Delete ${name}?`)) return;
    const full = normPath((path === '/' ? '' : path) + '/' + name);
    try {
      await fetch(`${API}/rm?path=${encodeURIComponent(full)}&recursive=${type === 'dir'}`, {
        method: 'DELETE', credentials: 'include',
      });
      load();
    } catch (e) { setError(e.message); }
  };

  const doUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const full = normPath((path === '/' ? '' : path) + '/' + file.name);
      try {
        await apiFetch(`${API}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: full, content: ev.target.result, mimeType: file.type || 'text/plain' }),
        });
        load();
      } catch (er) { setError(er.message); }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
  };

  const quotaPct = quota ? Math.min(100, Math.round(quota.used / quota.limit * 100)) : 0;

  return (
    <div style={S.root}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <button style={S.btn} onClick={goUp} title="Up one level">↑</button>
        <span style={S.pathBar}>{path || '/'}</span>
        <button style={S.btn} onClick={() => setShowMkdir(v => !v)}>+ Folder</button>
        <label style={S.btn}>
          Upload<input type="file" style={{ display: 'none' }} onChange={doUpload} />
        </label>
        <button style={S.btn} onClick={() => load()} title="Refresh">↻</button>
      </div>

      {/* New folder row */}
      {showMkdir && (
        <div style={{ display:'flex', gap:6, padding:'7px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink:0 }}>
          <input
            value={newDir}
            onChange={e => setNewDir(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doMkdir()}
            placeholder="Folder name"
            style={S.input}
            autoFocus
          />
          <button style={S.btn} onClick={doMkdir}>Create</button>
          <button style={S.btn} onClick={() => setShowMkdir(false)}>✕</button>
        </div>
      )}

      {error && <div style={S.err}>{error}</div>}

      {/* File list */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {loading && <div style={S.empty}>Loading…</div>}
        {!loading && entries.length === 0 && <div style={S.empty}>Empty directory</div>}
        {entries.map(e => (
          <div
            key={e.name}
            style={{ ...S.row, cursor: e.type === 'dir' ? 'pointer' : 'default' }}
            onDoubleClick={() => e.type === 'dir' && navigate(e.name)}
          >
            <span style={{ width: 22, color: 'rgba(255,255,255,0.4)', userSelect: 'none' }}>
              {e.type === 'dir' ? '📁' : '📄'}
            </span>
            <span style={S.name}>{e.name}</span>
            {e.size > 0 && <span style={S.meta}>{fmtSize(e.size)}</span>}
            {e.modified && <span style={{ ...S.meta, display: window.innerWidth > 500 ? undefined : 'none' }}>{e.modified.slice(0, 10)}</span>}
            <button
              style={{ ...S.btn, padding:'2px 6px', fontSize:11, color:'rgba(255,80,80,0.65)' }}
              onClick={() => doDelete(e.name, e.type)}
            >✕</button>
          </div>
        ))}
      </div>

      {/* Quota bar */}
      {quota && (
        <div style={S.quota}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <span>Storage</span>
            <span>{fmtSize(quota.used)} / {fmtSize(quota.limit)} ({quota.tier})</span>
          </div>
          <div style={{ height:3, background:'rgba(255,255,255,0.07)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${quotaPct}%`, background: quotaPct > 90 ? 'rgba(255,100,80,0.6)' : 'rgba(100,180,255,0.5)', borderRadius:2, transition:'width 0.4s' }} />
          </div>
        </div>
      )}
    </div>
  );
}
