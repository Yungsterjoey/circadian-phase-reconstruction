/**
 * KURO::SANDBOX PANEL v1.0
 * Claude.ai-like sandbox UI inside KuroChatApp
 *
 * Features:
 *  - Workspace selector (create / open)
 *  - File tree + create file
 *  - Code editor (textarea v1) + Run button
 *  - Output console (stdout/stderr)
 *  - Artifact preview tabs (HTML / Markdown / Image / Text)
 *  - "Attach to chat" button
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import MonacoEditor from '../ui/MonacoEditor';
import StackTrace from '../ui/StackTrace';
import {
  FolderPlus, Play, File, FileText, Image, Code, X, Plus, Square,
  ChevronRight, ChevronDown, RefreshCw, Paperclip, Terminal,
  Eye, Download, Loader, AlertCircle, CheckCircle2, FolderOpen,
  Trash2, Upload
} from 'lucide-react';

// ─── Auth helpers (mirror KuroChatApp pattern) ──────────────────────────────
function getToken() { return localStorage.getItem('kuro_token') || ''; }
function authHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'X-KURO-Token': getToken(), ...extra };
}
async function authFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: authHeaders(opts.headers || {}) });
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function WorkspaceSelector({ workspaces, activeWs, onSelect, onCreate, onRefresh, loading }) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await onCreate(newName.trim());
    setNewName('');
    setCreating(false);
  };

  return (
    <div className="sbx-ws-selector">
      <div className="sbx-ws-header">
        <span className="sbx-label">Workspaces</span>
        <button className="sbx-icon-btn" onClick={onRefresh} title="Refresh"><RefreshCw size={14} /></button>
      </div>
      <div className="sbx-ws-list">
        {loading && <div className="sbx-loading"><Loader size={14} className="spin" /> Loading…</div>}
        {workspaces.map(ws => (
          <button
            key={ws.id}
            className={`sbx-ws-item ${activeWs?.id === ws.id ? 'active' : ''}`}
            onClick={() => onSelect(ws)}
          >
            <FolderOpen size={14} />
            <span>{ws.name}</span>
          </button>
        ))}
      </div>
      <div className="sbx-ws-create">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New workspace…"
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <button className="sbx-icon-btn" onClick={handleCreate} disabled={creating || !newName.trim()}>
          <FolderPlus size={14} />
        </button>
      </div>
    </div>
  );
}

function FileTree({ files, activeFile, onSelect, onCreate }) {
  const [newFileName, setNewFileName] = useState('');

  return (
    <div className="sbx-file-tree">
      <div className="sbx-ft-header">
        <span className="sbx-label">Files</span>
      </div>
      <div className="sbx-ft-list">
        {files.map(f => (
          <button
            key={f.path}
            className={`sbx-ft-item ${activeFile === f.path ? 'active' : ''}`}
            onClick={() => onSelect(f.path)}
          >
            <FileText size={12} />
            <span>{f.path}</span>
            <span className="sbx-ft-size">{f.size > 1024 ? `${(f.size/1024).toFixed(1)}K` : `${f.size}B`}</span>
          </button>
        ))}
        {files.length === 0 && <div className="sbx-empty">No files yet</div>}
      </div>
      <div className="sbx-ft-create">
        <input
          value={newFileName}
          onChange={e => setNewFileName(e.target.value)}
          placeholder="new_file.py"
          onKeyDown={e => {
            if (e.key === 'Enter' && newFileName.trim()) {
              onCreate(newFileName.trim());
              setNewFileName('');
            }
          }}
        />
        <button className="sbx-icon-btn" onClick={() => {
          if (newFileName.trim()) { onCreate(newFileName.trim()); setNewFileName(''); }
        }}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function OutputConsole({ stdout, stderr, status, exitCode, lang, onNavigate }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [stdout, stderr]);

  return (
    <div className="sbx-console">
      <div className="sbx-console-header">
        <Terminal size={14} />
        <span>Output</span>
        {(status === 'running' || status === 'queued') && <Loader size={12} className="spin" />}
        {status === 'done' && exitCode === 0 && <CheckCircle2 size={12} style={{color:'#30d158'}} />}
        {['done','failed'].includes(status) && exitCode !== 0 && <AlertCircle size={12} style={{color:'#ff375f'}} />}
        {['done','failed'].includes(status) && <span className="sbx-exit">exit {exitCode}</span>}
        {['killed','timeout'].includes(status) && <span className="sbx-exit sbx-killed">{status}</span>}
      </div>
      <div className="sbx-console-body" ref={ref}>
        {stdout && <pre className="sbx-stdout">{stdout}</pre>}
        {stderr && <StackTrace text={stderr} lang={lang} onNavigate={onNavigate} className="sbx-stderr" />}
        {!stdout && !stderr && status !== 'running' && <span className="sbx-muted">No output</span>}
        {status === 'running' && !stdout && !stderr && <span className="sbx-muted">Running…</span>}
      </div>
    </div>
  );
}

function ArtifactPreview({ runId, artifacts, workspaceId }) {
  const [activeArt, setActiveArt] = useState(0);

  if (!artifacts || artifacts.length === 0) return null;

  const art = artifacts[activeArt];
  const ext = (art?.ext || art?.path?.split('.').pop() || '').toLowerCase().replace('.', '');
  const artUrl = `/api/runner/artifacts/${runId}/file?path=${encodeURIComponent(art.path)}`;

  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  const isHtml = ['html', 'htm'].includes(ext);
  const isText = ['txt', 'md', 'csv', 'json', 'py', 'js', 'ts', 'css', 'xml', 'log'].includes(ext);

  return (
    <div className="sbx-artifacts">
      <div className="sbx-art-tabs">
        {artifacts.map((a, i) => (
          <button key={a.path} className={`sbx-art-tab ${i === activeArt ? 'active' : ''}`} onClick={() => setActiveArt(i)}>
            {['png','jpg','jpeg','gif','webp','bmp','svg'].includes((a.ext||a.path.split('.').pop()||'').replace('.','').toLowerCase())
              ? <Image size={12} /> : <FileText size={12} />}
            <span>{a.path.split('/').pop()}</span>
          </button>
        ))}
      </div>
      <div className="sbx-art-preview">
        {isImage && <img src={artUrl} alt={art.path} style={{maxWidth:'100%',maxHeight:'400px',objectFit:'contain'}} />}
        {isHtml && (
          <iframe
            src={artUrl}
            title={art.path}
            sandbox="allow-scripts"
            style={{width:'100%',height:'400px',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'6px',background:'#fff'}}
          />
        )}
        {isText && <ArtifactTextPreview url={artUrl} />}
        {!isImage && !isHtml && !isText && <div className="sbx-muted">Preview not available for .{ext}</div>}
      </div>
      <div className="sbx-art-actions">
        <a href={artUrl} download={art.path.split('/').pop()} className="sbx-btn small"><Download size={12} /> Download</a>
      </div>
    </div>
  );
}

function ArtifactTextPreview({ url }) {
  const [content, setContent] = useState('');
  useEffect(() => {
    authFetch(url).then(r => r.text()).then(setContent).catch(() => setContent('[Failed to load]'));
  }, [url]);
  return <pre className="sbx-text-preview">{content.slice(0, 50000)}</pre>;
}

// ─── Main Panel ─────────────────────────────────────────────────────────────

export default function SandboxPanel({ onAttachArtifact, visible }) {
  // State
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWs, setActiveWs] = useState(null);
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [editorContent, setEditorContent] = useState('# Write your Python code here\nprint("Hello from KURO Sandbox!")\n');
  const [lang, setLang] = useState('python');
  const [runId, setRunId] = useState(null);
  const [runStatus, setRunStatus] = useState(null);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [exitCode, setExitCode] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState(null);
  const evsRef    = useRef(null);
  const editorRef = useRef(null);

  // ─── Load workspaces ──────────────────────────────────────────────────────
  const loadWorkspaces = useCallback(async () => {
    setWsLoading(true);
    try {
      const r = await authFetch('/api/sandbox/workspaces');
      if (r.ok) {
        const data = await r.json();
        setWorkspaces(data.workspaces || []);
      } else if (r.status === 403) {
        setError('Sandbox requires Pro or Sovereign tier.');
      }
    } catch (e) { setError(e.message); }
    setWsLoading(false);
  }, []);

  useEffect(() => { if (visible) loadWorkspaces(); }, [visible, loadWorkspaces]);

  // ─── Load files for active workspace ──────────────────────────────────────
  const loadFiles = useCallback(async () => {
    if (!activeWs) return;
    try {
      const r = await authFetch(`/api/sandbox/files/tree?workspaceId=${activeWs.id}`);
      if (r.ok) { const data = await r.json(); setFiles(data.files || []); }
    } catch {}
  }, [activeWs]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // ─── Create workspace ─────────────────────────────────────────────────────
  const createWorkspace = async (name) => {
    try {
      const r = await authFetch('/api/sandbox/workspaces', {
        method: 'POST', body: JSON.stringify({ name }),
      });
      if (r.ok) {
        const ws = await r.json();
        await loadWorkspaces();
        setActiveWs({ id: ws.id, name: ws.name });
      }
    } catch (e) { setError(e.message); }
  };

  // ─── Create file ──────────────────────────────────────────────────────────
  const createFile = async (fileName) => {
    if (!activeWs) return;
    try {
      await authFetch('/api/sandbox/files/write', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWs.id, filePath: fileName, content: '' }),
      });
      await loadFiles();
      setActiveFile(fileName);
      setEditorContent('');
    } catch (e) { setError(e.message); }
  };

  // ─── Save file ────────────────────────────────────────────────────────────
  const saveFile = async () => {
    if (!activeWs || !activeFile) return;
    try {
      await authFetch('/api/sandbox/files/write', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWs.id, filePath: activeFile, content: editorContent }),
      });
      await loadFiles();
    } catch (e) { setError(e.message); }
  };

  // ─── Load file content ────────────────────────────────────────────────────
  const loadFileContent = useCallback(async (filePath) => {
    if (!activeWs) return;
    setActiveFile(filePath);
    try {
      const r = await authFetch(
        `/api/sandbox/files/read?workspaceId=${encodeURIComponent(activeWs.id)}&filePath=${encodeURIComponent(filePath)}`
      );
      if (r.ok) {
        const data = await r.json();
        setEditorContent(data.content ?? '');
      }
    } catch (e) { setError(e.message); }
  }, [activeWs]);

  // ─── Connect SSE stream ────────────────────────────────────────────────────
  const connectSSE = useCallback((jobId) => {
    if (evsRef.current) evsRef.current.abort();
    const controller = new AbortController();
    evsRef.current = controller;

    (async () => {
      try {
        const res = await fetch(`/api/runner/events/${jobId}`, {
          headers: { 'X-KURO-Token': getToken() },
          signal: controller.signal,
        });
        if (!res.ok) { setError(`Stream error: ${res.status}`); setRunLoading(false); return; }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.t === 'stdout') setStdout(prev => prev + evt.d);
              else if (evt.t === 'stderr') setStderr(prev => prev + evt.d);
              else if (evt.t === 'sys') setStdout(prev => prev + evt.d);
              else if (evt.t === 'status') {
                setRunStatus(evt.status);
                setExitCode(evt.exitCode ?? null);
                setRunLoading(false);
                if (['done', 'failed', 'killed', 'timeout'].includes(evt.status)) {
                  authFetch(`/api/runner/artifacts/${jobId}`)
                    .then(r => r.json()).then(d => setArtifacts(d.artifacts || [])).catch(() => {});
                }
                controller.abort();
              }
            } catch { /* malformed event */ }
          }
        }
      } catch (e) {
        if (e.name !== 'AbortError') { setError(e.message); setRunLoading(false); }
      }
    })();
  }, []);

  // ─── Run code ─────────────────────────────────────────────────────────────
  const runCode = async () => {
    setRunLoading(true);
    setRunStatus('queued');
    setStdout('');
    setStderr('');
    setExitCode(null);
    setArtifacts([]);
    setError(null);

    const cmd = activeFile || (lang === 'node' ? 'index.js' : 'main.py');
    try {
      const r = await authFetch('/api/runner/spawn', {
        method: 'POST',
        body: JSON.stringify({ cmd, lang, inlineCode: editorContent }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || 'Spawn failed'); setRunLoading(false); setRunStatus('failed'); return; }
      setRunId(data.jobId);
      connectSSE(data.jobId);
    } catch (e) {
      setError(e.message);
      setRunLoading(false);
      setRunStatus('failed');
    }
  };

  // ─── Kill job ─────────────────────────────────────────────────────────────
  const killJob = async () => {
    if (!runId) return;
    try { await authFetch(`/api/runner/kill/${runId}`, { method: 'POST' }); }
    catch (e) { setError(e.message); }
  };

  // Cleanup SSE on unmount
  useEffect(() => () => { if (evsRef.current) evsRef.current.abort(); }, []);

  // ─── Navigate to file + line from StackTrace click ───────────────────────
  const handleNavigate = useCallback(async (fileName, line) => {
    const match = files.find(f => f.path === fileName || f.path.endsWith('/' + fileName));
    if (!match) return;
    await loadFileContent(match.path);
    setTimeout(() => editorRef.current?.revealLine(line), 80);
  }, [files, loadFileContent]);

  // ─── Attach to chat ───────────────────────────────────────────────────────
  const handleAttach = () => {
    if (onAttachArtifact && artifacts.length && runId) {
      onAttachArtifact({
        runId, artifacts,
        summary: `Sandbox run ${runId.slice(0, 8)}: ${artifacts.length} artifact(s), exit ${exitCode}`,
      });
    }
  };

  if (!visible) return null;

  return (
    <div className="sbx-panel">
      <div className="sbx-sidebar">
        <WorkspaceSelector
          workspaces={workspaces}
          activeWs={activeWs}
          onSelect={(ws) => { setActiveWs(ws); setActiveFile(null); setEditorContent(''); }}
          onCreate={createWorkspace}
          onRefresh={loadWorkspaces}
          loading={wsLoading}
        />
        {activeWs && (
          <FileTree
            files={files}
            activeFile={activeFile}
            onSelect={loadFileContent}
            onCreate={createFile}
          />
        )}
      </div>

      <div className="sbx-main">
        {!activeWs ? (
          <div className="sbx-empty-state">
            <Code size={48} style={{opacity:0.3}} />
            <p>Select or create a workspace to start coding</p>
          </div>
        ) : (
          <>
            <div className="sbx-editor-header">
              <span className="sbx-file-name">
                <FileText size={14} /> {activeFile || '(no file selected)'}
              </span>
              <div className="sbx-editor-actions">
                <select className="sbx-lang-select" value={lang} onChange={e => setLang(e.target.value)} disabled={runLoading}>
                  <option value="python">Python</option>
                  <option value="node">Node.js</option>
                </select>
                <button className="sbx-btn" onClick={saveFile} disabled={!activeFile}>Save</button>
                {runLoading && (
                  <button className="sbx-btn danger" onClick={killJob}><Square size={14} /> Kill</button>
                )}
                <button className="sbx-btn primary" onClick={runCode} disabled={runLoading}>
                  {runLoading ? <><Loader size={14} className="spin" /> Running…</> : <><Play size={14} /> Run</>}
                </button>
              </div>
            </div>

            <div className="sbx-editor">
              <MonacoEditor
                value={editorContent}
                onChange={setEditorContent}
                language={lang === 'node' ? 'javascript' : 'python'}
                height="100%"
                disabled={!activeFile}
                editorRef={editorRef}
              />
            </div>

            {error && (
              <div className="sbx-error">
                <AlertCircle size={14} /> {error}
                <button onClick={() => setError(null)}><X size={12} /></button>
              </div>
            )}

            <OutputConsole stdout={stdout} stderr={stderr} status={runStatus} exitCode={exitCode} lang={lang} onNavigate={handleNavigate} />

            <ArtifactPreview runId={runId} artifacts={artifacts} workspaceId={activeWs?.id} />

            {artifacts.length > 0 && onAttachArtifact && (
              <button className="sbx-btn attach" onClick={handleAttach}>
                <Paperclip size={14} /> Attach to Chat
              </button>
            )}
          </>
        )}
      </div>

      <style>{`
/* ═══════════════════════════════════════════════════════════════════════════
   KURO SANDBOX PANEL v1.0 — Dark theme, matches kuro-v72
═══════════════════════════════════════════════════════════════════════════ */
.sbx-panel {
  display: flex; height: 100%; min-height: 400px;
  background: rgba(0,0,0,0.3); border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.08);
  overflow: hidden; font-size: 13px;
}
.sbx-sidebar {
  width: 220px; min-width: 180px; border-right: 1px solid rgba(255,255,255,0.08);
  display: flex; flex-direction: column; overflow-y: auto;
  background: rgba(255,255,255,0.02);
}
.sbx-main {
  flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 0;
}
.sbx-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.4); font-weight: 600; }
.sbx-icon-btn {
  background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px;
  border-radius: 4px; display: flex; align-items: center;
}
.sbx-icon-btn:hover { color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.08); }
.sbx-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
  border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.85); cursor: pointer; font-size: 12px; white-space: nowrap;
}
.sbx-btn:hover { background: rgba(255,255,255,0.12); }
.sbx-btn.primary { background: rgba(168,85,247,0.25); border-color: rgba(168,85,247,0.4); color: #c084fc; }
.sbx-btn.primary:hover { background: rgba(168,85,247,0.4); }
.sbx-btn.small { padding: 4px 8px; font-size: 11px; }
.sbx-btn.attach { margin: 8px 12px; align-self: flex-start; }
.sbx-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.sbx-btn.danger { background: rgba(255,55,95,0.15); border-color: rgba(255,55,95,0.3); color: #ff6b8a; }
.sbx-btn.danger:hover { background: rgba(255,55,95,0.25); }
.sbx-lang-select {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px; padding: 5px 8px; color: rgba(255,255,255,0.85);
  font-size: 12px; cursor: pointer; outline: none;
}
.sbx-lang-select:focus { border-color: rgba(168,85,247,0.5); }
.sbx-killed { color: #ff9500; }

/* Workspace selector */
.sbx-ws-selector { padding: 8px; }
.sbx-ws-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 4px; }
.sbx-ws-list { display: flex; flex-direction: column; gap: 2px; max-height: 150px; overflow-y: auto; }
.sbx-ws-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  border: none; background: none; color: rgba(255,255,255,0.7); cursor: pointer;
  border-radius: 6px; text-align: left; font-size: 12px; width: 100%;
}
.sbx-ws-item:hover { background: rgba(255,255,255,0.06); }
.sbx-ws-item.active { background: rgba(168,85,247,0.15); color: #c084fc; }
.sbx-ws-create {
  display: flex; gap: 4px; margin-top: 6px;
}
.sbx-ws-create input {
  flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; padding: 5px 8px; color: rgba(255,255,255,0.9); font-size: 12px; outline: none;
}
.sbx-ws-create input:focus { border-color: rgba(168,85,247,0.5); }

/* File tree */
.sbx-file-tree { padding: 8px; border-top: 1px solid rgba(255,255,255,0.06); flex: 1; overflow-y: auto; }
.sbx-ft-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 4px; }
.sbx-ft-list { display: flex; flex-direction: column; gap: 1px; }
.sbx-ft-item {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px;
  border: none; background: none; color: rgba(255,255,255,0.65); cursor: pointer;
  border-radius: 4px; font-size: 11px; width: 100%; text-align: left; font-family: 'SF Mono', monospace;
}
.sbx-ft-item:hover { background: rgba(255,255,255,0.06); }
.sbx-ft-item.active { background: rgba(168,85,247,0.12); color: #c084fc; }
.sbx-ft-size { margin-left: auto; color: rgba(255,255,255,0.3); font-size: 10px; }
.sbx-ft-create { display: flex; gap: 4px; margin-top: 6px; }
.sbx-ft-create input {
  flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px; padding: 4px 6px; color: rgba(255,255,255,0.9); font-size: 11px;
  font-family: 'SF Mono', monospace; outline: none;
}

/* Editor */
.sbx-editor-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
}
.sbx-file-name { display: flex; align-items: center; gap: 6px; color: rgba(255,255,255,0.6); font-size: 12px; }
.sbx-editor-actions { display: flex; gap: 6px; }
.sbx-editor {
  flex: 1; min-height: 200px; background: #09090e;
}

/* Console */
.sbx-console { border-top: 1px solid rgba(255,255,255,0.06); }
.sbx-console-header {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px;
  background: rgba(255,255,255,0.02); font-size: 11px; color: rgba(255,255,255,0.5);
}
.sbx-exit { font-family: monospace; font-size: 10px; }
.sbx-console-body {
  max-height: 200px; overflow-y: auto; padding: 8px 12px; margin: 0;
  font-family: 'SF Mono', monospace; font-size: 12px; line-height: 1.5;
  background: rgba(0,0,0,0.3);
}
.sbx-stdout { color: rgba(255,255,255,0.8); white-space: pre-wrap; word-break: break-all; margin: 0; padding: 0; }
.sbx-stderr { color: #ff375f; }
.sbx-muted { color: rgba(255,255,255,0.25); font-style: italic; }

/* Artifacts */
.sbx-artifacts { border-top: 1px solid rgba(255,255,255,0.06); }
.sbx-art-tabs {
  display: flex; gap: 2px; padding: 6px 12px; background: rgba(255,255,255,0.02);
  overflow-x: auto; flex-wrap: nowrap;
}
.sbx-art-tab {
  display: flex; align-items: center; gap: 4px; padding: 4px 10px;
  border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04);
  border-radius: 4px; color: rgba(255,255,255,0.6); font-size: 11px; cursor: pointer; white-space: nowrap;
}
.sbx-art-tab.active { background: rgba(168,85,247,0.15); border-color: rgba(168,85,247,0.3); color: #c084fc; }
.sbx-art-preview { padding: 12px; min-height: 100px; }
.sbx-art-actions { padding: 6px 12px; }
.sbx-text-preview {
  max-height: 300px; overflow-y: auto; font-family: 'SF Mono', monospace;
  font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.8);
  background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px;
  white-space: pre-wrap; word-break: break-word; margin: 0;
}

/* Error */
.sbx-error {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: rgba(255,55,95,0.1); border: 1px solid rgba(255,55,95,0.2);
  color: #ff6b8a; font-size: 12px; margin: 4px 12px; border-radius: 6px;
}
.sbx-error button { background: none; border: none; color: inherit; cursor: pointer; margin-left: auto; }

/* Empty state */
.sbx-empty-state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: rgba(255,255,255,0.3);
}
.sbx-empty { padding: 12px; color: rgba(255,255,255,0.25); font-size: 11px; text-align: center; }
.sbx-loading { display: flex; align-items: center; gap: 6px; padding: 8px; color: rgba(255,255,255,0.4); font-size: 12px; }

/* Animations */
@keyframes sbx-spin { to { transform: rotate(360deg); } }
.spin { animation: sbx-spin 1s linear infinite; }

/* Responsive */
@media (max-width: 768px) {
  .sbx-panel { flex-direction: column; }
  .sbx-sidebar { width: 100%; max-height: 200px; border-right: none; border-bottom: 1px solid rgba(255,255,255,0.08); }
}
      `}</style>
    </div>
  );
}
