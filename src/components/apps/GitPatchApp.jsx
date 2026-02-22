/**
 * GitPatchApp — KURO Phase 5
 *
 * Git-style patch workflow: paste/upload unified diffs, preview in DiffViewer,
 * apply with one click, create named snapshots, and rollback.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import MonacoEditor from '../ui/MonacoEditor';
import DiffViewer from '../ui/DiffViewer';

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiPost(endpoint, body) {
  const r = await fetch(`/api/git/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function apiGet(endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`/api/git/${endpoint}?${qs}`, { credentials: 'include' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function vfsRead(vfsPath) {
  const r = await fetch(`/api/vfs/read?path=${encodeURIComponent(vfsPath)}`, { credentials: 'include' });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `VFS read failed (${r.status})`);
  }
  return await r.text();
}

// ─── Component ────────────────────────────────────────────────────────────────

const GitPatchApp = () => {
  const [path, setPath] = useState('/my/file.py');
  const [patchText, setPatchText] = useState('');
  const [original, setOriginal] = useState('');
  const [preview, setPreview] = useState(null);        // { newContent, additions, deletions }
  const [branches, setBranches] = useState([]);
  const [newBranchName, setNewBranchName] = useState('main');
  const [status, setStatus] = useState({ msg: '', type: 'ok' });
  const previewTimer = useRef(null);

  // ── Load original content when path changes ──────────────────────────────
  useEffect(() => {
    if (!path.trim()) return;
    setOriginal('');
    setPreview(null);
    vfsRead(path)
      .then(c => setOriginal(c))
      .catch(e => setStatus({ msg: `Could not load file: ${e.message}`, type: 'error' }));
    loadBranches(path);
  }, [path]);

  // ── Auto-preview as patch text changes (debounced 400 ms) ────────────────
  useEffect(() => {
    clearTimeout(previewTimer.current);
    if (!patchText.trim()) { setPreview(null); return; }
    previewTimer.current = setTimeout(async () => {
      try {
        const result = await apiPost('diff', { path, original, patch: patchText });
        setPreview(result);
        setStatus({ msg: `Preview: +${result.additions} -${result.deletions}`, type: 'ok' });
      } catch (e) {
        setPreview(null);
        setStatus({ msg: `Diff error: ${e.message}`, type: 'error' });
      }
    }, 400);
    return () => clearTimeout(previewTimer.current);
  }, [patchText, original, path]);

  function loadBranches(p) {
    if (!p.trim()) return;
    apiGet('branch', { path: p })
      .then(d => setBranches(d.branches || []))
      .catch(() => setBranches([]));
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  const handleApply = useCallback(async () => {
    try {
      setStatus({ msg: 'Applying…', type: 'ok' });
      const r = await apiPost('apply', { path, original, patch: patchText });
      setOriginal(r.newContent);
      setPreview(null);
      setPatchText('');
      setStatus({ msg: 'Patch applied successfully.', type: 'ok' });
    } catch (e) {
      setStatus({ msg: `Apply failed: ${e.message}`, type: 'error' });
    }
  }, [path, original, patchText]);

  // ── Create branch snapshot ────────────────────────────────────────────────
  const handleCreateBranch = useCallback(async () => {
    const branch = newBranchName.trim();
    if (!branch) return;
    try {
      await apiPost('branch', { path, branch, content: original });
      setStatus({ msg: `Snapshot "${branch}" created.`, type: 'ok' });
      loadBranches(path);
    } catch (e) {
      setStatus({ msg: `Branch failed: ${e.message}`, type: 'error' });
    }
  }, [path, newBranchName, original]);

  // ── Rollback ──────────────────────────────────────────────────────────────
  const handleRollback = useCallback(async (branch) => {
    try {
      setStatus({ msg: `Rolling back to "${branch}"…`, type: 'ok' });
      const r = await apiPost('rollback', { path, branch });
      setOriginal(r.content);
      setPreview(null);
      setPatchText('');
      setStatus({ msg: `Rolled back to "${branch}".`, type: 'ok' });
    } catch (e) {
      setStatus({ msg: `Rollback failed: ${e.message}`, type: 'error' });
    }
  }, [path]);

  const canApply = patchText.trim() && preview?.newContent != null;

  return (
    <div className="gp-root">
      {/* ── Sidebar ── */}
      <div className="gp-sidebar">
        <div style={{ padding: '12px 14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="gp-label">VFS Path</label>
            <input
              className="gp-input"
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder="/my/file.py"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="gp-label">Snapshot name</label>
            <input
              className="gp-input"
              value={newBranchName}
              onChange={e => setNewBranchName(e.target.value)}
              placeholder="main"
              spellCheck={false}
            />
          </div>
          <button className="gp-btn gp-btn-secondary" onClick={handleCreateBranch}>
            Create Snapshot
          </button>
        </div>

        <div className="gp-branch-list">
          {branches.length === 0
            ? <p className="gp-hint">No snapshots yet.</p>
            : branches.map(b => (
              <div key={b.id} className="gp-branch-row">
                <div className="gp-branch-name">{b.branchName}</div>
                <div className="gp-branch-date">{new Date(b.createdAt).toLocaleDateString()}</div>
                <button
                  className="gp-branch-rollback"
                  title={`Rollback to "${b.branchName}"`}
                  onClick={() => handleRollback(b.branchName)}
                >↩</button>
              </div>
            ))
          }
        </div>
      </div>

      {/* ── Main ── */}
      <div className="gp-main">
        {/* Toolbar */}
        <div className="gp-toolbar">
          <span className="gp-toolbar-title">Git Patch</span>
          <div style={{ flex: 1 }} />
          <button
            className="gp-btn gp-btn-primary"
            disabled={!canApply}
            onClick={handleApply}
          >
            Apply Patch
          </button>
        </div>

        {/* Patch input */}
        <div className="gp-patch-pane">
          <div style={{ height: '100%' }}>
            <MonacoEditor
              value={patchText}
              onChange={setPatchText}
              language="diff"
              height="100%"
            />
          </div>
        </div>

        {/* Diff preview */}
        <div className="gp-preview-pane">
          {preview?.newContent != null
            ? (
              <DiffViewer
                filename={path}
                original={original}
                modified={preview.newContent}
                height="100%"
              />
            )
            : (
              <div className="gp-no-preview">
                {patchText.trim()
                  ? 'Patch does not apply cleanly — check the diff output above.'
                  : 'Paste a unified diff in the editor above to preview changes.'}
              </div>
            )
          }
        </div>

        {/* Status bar */}
        <div className={`gp-status gp-status-${status.type}`}>
          {status.msg || 'Ready'}
        </div>
      </div>
    </div>
  );
};

export default GitPatchApp;
