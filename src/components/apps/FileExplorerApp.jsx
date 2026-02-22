/**
 * KURO FileExplorerApp v2.0
 * VFS file browser + Monaco editor + DiffViewer.
 * Backend: /api/vfs/*
 *
 * Phase 4 additions:
 *  - Click a file to open it in Monaco editor (right pane)
 *  - Save via toolbar button or Ctrl/Cmd+S
 *  - Diff button compares original (on-disk) vs current (editor)
 *  - Accept (save + dismiss diff) / Reject (revert + dismiss diff)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import MonacoEditor, { detectLang } from '../ui/MonacoEditor';
import DiffViewer from '../ui/DiffViewer';

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

// Highlight first occurrence of q within text
function highlightMatch(text, q) {
  if (!q || !text) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="sr-match">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

const S = {
  root:    { display:'flex', flexDirection:'column', height:'100%', background:'rgba(10,10,20,0.95)', color:'rgba(255,255,255,0.88)', fontFamily:'monospace', fontSize:13 },
  toolbar: { display:'flex', alignItems:'center', gap:6, padding:'9px 12px', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 },
  pathBar: { flex:1, color:'rgba(255,255,255,0.4)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12 },
  btn:     { background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'rgba(255,255,255,0.7)', cursor:'pointer', padding:'4px 10px', fontSize:12 },
  input:   { flex:1, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:6, padding:'4px 8px', color:'rgba(255,255,255,0.88)', fontSize:13 },
  row:     { display:'flex', alignItems:'center', padding:'6px 12px', borderBottom:'1px solid rgba(255,255,255,0.04)', cursor:'pointer' },
  rowAct:  { background:'rgba(168,85,247,0.1)' },
  name:    { flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  meta:    { color:'rgba(255,255,255,0.3)', fontSize:11, marginRight:10, whiteSpace:'nowrap' },
  err:     { padding:'8px 12px', background:'rgba(255,50,50,0.1)', color:'#ff6060', fontSize:12, flexShrink:0 },
  empty:   { padding:'24px 12px', color:'rgba(255,255,255,0.25)', textAlign:'center' },
  quota:   { padding:'7px 12px', borderTop:'1px solid rgba(255,255,255,0.06)', flexShrink:0, fontSize:11, color:'rgba(255,255,255,0.3)' },
};

export default function FileExplorerApp() {
  const [path,       setPath]       = useState('/');
  const [entries,    setEntries]    = useState([]);
  const [quota,      setQuota]      = useState(null);
  const [error,      setError]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [newDir,     setNewDir]     = useState('');
  const [showMkdir,  setShowMkdir]  = useState(false);

  // Editor state
  const [openFile,   setOpenFile]   = useState(null);   // full VFS path
  const [origContent, setOrigContent] = useState('');   // content at open time
  const [showDiff,   setShowDiff]   = useState(false);
  const [editorKey,  setEditorKey]  = useState(0);      // force remount on new file
  const editorRef = useRef(null);                       // { revealLine, format, save, getValue, getOriginal }

  // Search state
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchActive,  setSearchActive]  = useState(false);
  const [searchError,   setSearchError]   = useState('');
  const pendingRevealLine = useRef(null);

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
    setPath(next); load(next);
  };

  const goUp = () => {
    const parts = path.split('/').filter(Boolean);
    const up = parts.length > 0 ? '/' + parts.slice(0, -1).join('/') : '/';
    setPath(up); load(up);
  };

  // Open file in Monaco
  const openInEditor = async (name) => {
    const full = normPath((path === '/' ? '' : path) + '/' + name);
    try {
      // Fetch original content for diff comparison
      const r = await fetch(`${API}/read?path=${encodeURIComponent(full)}`, {
        credentials: 'include',
        headers: { 'X-KURO-Token': localStorage.getItem('kuro_token') || '' },
      });
      const text = r.ok ? await r.text() : '';
      setOrigContent(text);
      setOpenFile(full);
      setShowDiff(false);
      setEditorKey(k => k + 1); // remount Monaco with new file
    } catch { /* load error handled inside MonacoEditor */ }
  };

  const handleSave = useCallback((newContent) => {
    // After VFS save, update origContent so diff reflects the saved baseline
    setOrigContent(newContent);
    setShowDiff(false);
  }, []);

  // Diff: compare origContent vs current editor value
  const handleShowDiff = () => {
    setShowDiff(v => !v);
  };

  // Accept diff → save the current content, dismiss diff
  const handleAccept = async () => {
    const current = editorRef.current?.getValue() ?? '';
    try {
      const r = await fetch(`${API}/write`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-KURO-Token': localStorage.getItem('kuro_token') || '',
        },
        body: JSON.stringify({ path: openFile, content: current }),
      });
      if (r.ok) { setOrigContent(current); setShowDiff(false); }
    } catch (e) { setError(e.message); }
  };

  // Reject diff → revert editor to origContent
  const handleReject = () => {
    setEditorKey(k => k + 1); // remount MonacoEditor — it will reload vfsPath
    setShowDiff(false);
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
      setNewDir(''); setShowMkdir(false); load();
    } catch (e) { setError(e.message); }
  };

  const doDelete = async (name, type) => {
    if (!confirm(`Delete ${name}?`)) return;
    const full = normPath((path === '/' ? '' : path) + '/' + name);
    try {
      await fetch(`${API}/rm?path=${encodeURIComponent(full)}&recursive=${type === 'dir'}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (openFile === full) { setOpenFile(null); setShowDiff(false); }
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

  // Open a file by its full VFS path (used by search click-to-navigate)
  const openByPath = useCallback(async (fullPath, revealAtLine = null) => {
    if (revealAtLine != null) pendingRevealLine.current = revealAtLine;
    try {
      const r = await fetch(`${API}/read?path=${encodeURIComponent(fullPath)}`, { credentials: 'include' });
      const text = r.ok ? await r.text() : '';
      setOrigContent(text);
      setOpenFile(fullPath);
      setShowDiff(false);
      setEditorKey(k => k + 1);
    } catch { /* ignore — editor will show load error */ }
  }, []);

  // After editorKey changes (new file opened), reveal any pending line
  useEffect(() => {
    if (pendingRevealLine.current == null) return;
    const line = pendingRevealLine.current;
    const timer = setTimeout(() => {
      editorRef.current?.revealLine(line);
      pendingRevealLine.current = null;
    }, 320);
    return () => clearTimeout(timer);
  }, [editorKey]);

  // Search — scoped to current directory path
  const doSearch = useCallback(async (q) => {
    if (!q.trim()) return;
    setSearchLoading(true);
    setSearchError('');
    setSearchResults([]);
    try {
      const params = new URLSearchParams({ q });
      if (path && path !== '/') params.set('path', path);
      const r = await fetch(`/api/search?${params}`, { credentials: 'include' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Search failed');
      setSearchResults(data.results || []);
      if ((data.results || []).length === 0) setSearchError('No matches found.');
    } catch (e) {
      setSearchError(e.message);
    } finally {
      setSearchLoading(false);
    }
  }, [path]);

  const quotaPct = quota ? Math.min(100, Math.round(quota.used / quota.limit * 100)) : 0;

  // Current editor value for diff (only available after Monaco mounts)
  const currentEditorValue = editorRef.current?.getValue?.() ?? '';

  return (
    <div style={S.root}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <button style={S.btn} onClick={goUp} title="Up one level">↑</button>
        <span style={S.pathBar}>{path || '/'}</span>
        <button style={S.btn} onClick={() => setShowMkdir(v => !v)}>+ Folder</button>
        <label style={S.btn}>
          Upload<input type="file" style={{ display:'none' }} onChange={doUpload} />
        </label>
        <button style={S.btn} onClick={() => load()} title="Refresh">↻</button>
        <button
          style={{ ...S.btn, ...(searchActive ? { color:'rgba(168,85,247,0.9)', borderColor:'rgba(168,85,247,0.3)' } : {}) }}
          onClick={() => { setSearchActive(v => !v); setSearchResults([]); setSearchError(''); }}
          title="Search files"
        >🔍</button>
        {openFile && !showDiff && (
          <button style={{ ...S.btn, color:'rgba(168,85,247,0.85)', borderColor:'rgba(168,85,247,0.3)' }}
            onClick={handleShowDiff} title="Show diff vs saved">
            Diff
          </button>
        )}
        {openFile && showDiff && (
          <button style={S.btn} onClick={() => setShowDiff(false)}>← Editor</button>
        )}
      </div>

      {/* New folder row */}
      {showMkdir && (
        <div style={{ display:'flex', gap:6, padding:'7px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink:0 }}>
          <input value={newDir} onChange={e => setNewDir(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doMkdir()}
            placeholder="Folder name" style={S.input} autoFocus />
          <button style={S.btn} onClick={doMkdir}>Create</button>
          <button style={S.btn} onClick={() => setShowMkdir(false)}>✕</button>
        </div>
      )}

      {/* Search bar */}
      {searchActive && (
        <div style={{ display:'flex', gap:6, padding:'7px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink:0, alignItems:'center' }}>
          <input
            className="sr-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch(searchQuery)}
            placeholder={`Search in ${path === '/' ? 'all files' : path}…`}
            style={S.input}
            autoFocus
          />
          <button style={S.btn} onClick={() => doSearch(searchQuery)} disabled={searchLoading}>
            {searchLoading ? '…' : 'Go'}
          </button>
        </div>
      )}

      {error && <div style={S.err}>{error}</div>}

      {/* Split: file list | editor/diff */}
      <div className="fe-split">
        {/* File list — replaced by search results when search is active */}
        <div className={`fe-files ${openFile ? '' : ''}`} style={openFile ? {} : { width: '100%' }}>
          {/* Search results */}
          {searchActive && (searchLoading || searchResults.length > 0 || searchError) && (
            <div className="sr-results">
              {searchLoading && <div style={S.empty}>Searching…</div>}
              {!searchLoading && searchError && <div style={{ ...S.empty, color:'rgba(255,120,120,0.7)' }}>{searchError}</div>}
              {!searchLoading && searchResults.map((r, i) => (
                <div
                  key={i}
                  className="sr-result-row"
                  onClick={() => openByPath(r.file, r.line)}
                  title={`${r.file} line ${r.line}`}
                >
                  <div className="sr-result-meta">
                    <span className="sr-result-file">{r.file.split('/').pop()}</span>
                    <span className="sr-result-line">:{r.line}</span>
                    <span className="sr-result-path">{r.file}</span>
                  </div>
                  <div className="sr-result-preview">
                    {highlightMatch(r.preview.trim(), searchQuery)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Normal file list — hidden when search has results */}
          {(!searchActive || (!searchLoading && searchResults.length === 0 && !searchError)) && (
            <>
          {loading && <div style={S.empty}>Loading…</div>}
          {!loading && entries.length === 0 && <div style={S.empty}>Empty directory</div>}
          {entries.map(e => (
            <div
              key={e.name}
              style={{
                ...S.row,
                ...(openFile === normPath((path==='/'?'':path)+'/'+e.name) ? S.rowAct : {}),
              }}
              onDoubleClick={() => e.type === 'dir' && navigate(e.name)}
              onClick={() => e.type === 'file' && openInEditor(e.name)}
            >
              <span style={{ width:22, color:'rgba(255,255,255,0.4)', userSelect:'none' }}>
                {e.type === 'dir' ? '📁' : '📄'}
              </span>
              <span style={S.name}>{e.name}</span>
              {e.size > 0 && <span style={S.meta}>{fmtSize(e.size)}</span>}
              <button
                style={{ ...S.btn, padding:'2px 6px', fontSize:11, color:'rgba(255,80,80,0.65)' }}
                onClick={ev => { ev.stopPropagation(); doDelete(e.name, e.type); }}
              >✕</button>
            </div>
          ))}
            </>
          )}
        </div>

        {/* Editor / Diff pane */}
        {openFile && (
          <div className="fe-editor-pane">
            {showDiff ? (
              <div className="fe-diff-pane">
                <DiffViewer
                  filename={openFile}
                  language={detectLang(openFile)}
                  original={origContent}
                  modified={currentEditorValue}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  height="100%"
                />
              </div>
            ) : (
              <MonacoEditor
                key={editorKey}
                vfsPath={openFile}
                height="100%"
                onSave={handleSave}
                editorRef={editorRef}
              />
            )}
          </div>
        )}

        {!openFile && (
          <div className="fe-editor-empty" style={{ display: entries.length > 0 ? 'none' : 'none' }} />
        )}
      </div>

      {/* Quota bar */}
      {quota && (
        <div style={S.quota}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <span>Storage</span>
            <span>{fmtSize(quota.used)} / {fmtSize(quota.limit)} ({quota.tier})</span>
          </div>
          <div style={{ height:3, background:'rgba(255,255,255,0.07)', borderRadius:2, overflow:'hidden' }}>
            <div style={{
              height:'100%', width:`${quotaPct}%`,
              background: quotaPct > 90 ? 'rgba(255,100,80,0.6)' : 'rgba(100,180,255,0.5)',
              borderRadius:2, transition:'width 0.4s',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}
