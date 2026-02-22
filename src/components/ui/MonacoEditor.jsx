/**
 * MonacoEditor — KURO Phase 4
 *
 * Thin wrapper around @monaco-editor/react with KURO dark theme.
 * Supports two modes:
 *
 *   Controlled  — pass `value` + `onChange` (SandboxPanel usage).
 *                 Parent owns content; this component is a styled Monaco textarea.
 *
 *   VFS         — pass `vfsPath` without `value`.
 *                 Loads/saves from /api/vfs/* automatically.
 *
 * Common props:
 *   language    — Monaco language id (auto-detected from path if omitted)
 *   readOnly    — bool
 *   height      — CSS string, default '100%'
 *   disabled    — dims editor and prevents edits
 *   onSave      — (content, originalContent) => void (VFS: called after PUT)
 *   editorRef   — ref receiving { revealLine(n), format(), save() }
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';

// ── Language map ────────────────────────────────────────────────────────────
const LANG_MAP = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  py: 'python',
  json: 'json', jsonl: 'json',
  md: 'markdown',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css',
  sh: 'shell', bash: 'shell',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml',
  txt: 'plaintext',
};

export function detectLang(filePath) {
  if (!filePath) return 'plaintext';
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  return LANG_MAP[ext] || 'plaintext';
}

// ── KURO dark theme (defined once per page) ─────────────────────────────────
let _themeRegistered = false;
function ensureTheme(monaco) {
  if (_themeRegistered) return;
  _themeRegistered = true;
  monaco.editor.defineTheme('kuro-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment',  foreground: '5c6e8a', fontStyle: 'italic' },
      { token: 'keyword',  foreground: 'c084fc' },
      { token: 'string',   foreground: '86efac' },
      { token: 'number',   foreground: 'fdba74' },
      { token: 'type',     foreground: '7dd3fc' },
      { token: 'function', foreground: 'a5b4fc' },
    ],
    colors: {
      'editor.background':                  '#09090e',
      'editor.foreground':                  '#dde1ec',
      'editorLineNumber.foreground':        '#3a3a5c',
      'editorLineNumber.activeForeground':  '#7c7ca8',
      'editor.lineHighlightBackground':     '#12121e',
      'editor.selectionBackground':         '#3d3d6b',
      'editor.inactiveSelectionBackground': '#2a2a4a',
      'editorCursor.foreground':            '#c084fc',
      'editorWidget.background':            '#0f0f1a',
      'editorSuggestWidget.background':     '#0f0f1a',
      'editorSuggestWidget.border':         '#2a2a4a',
      'scrollbarSlider.background':         '#1e1e3a80',
      'scrollbarSlider.hoverBackground':    '#2a2a5a80',
    },
  });
}

const EDITOR_OPTIONS = {
  fontSize:               13,
  lineHeight:             20,
  fontFamily:             "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontLigatures:          true,
  minimap:                { enabled: false },
  scrollBeyondLastLine:   false,
  automaticLayout:        true,
  tabSize:                2,
  insertSpaces:           true,
  renderLineHighlight:    'line',
  bracketPairColorization: { enabled: true },
  padding:                { top: 8, bottom: 8 },
  smoothScrolling:        true,
  cursorBlinking:         'smooth',
  renderWhitespace:       'boundary',
  overviewRulerLanes:     0,
};

// ── Auth helper ─────────────────────────────────────────────────────────────
function vfsFetch(url, opts = {}) {
  return fetch(url, {
    credentials: 'include',
    ...opts,
    headers: {
      'X-KURO-Token': localStorage.getItem('kuro_token') || '',
      ...(opts.headers || {}),
    },
  });
}

// ── Component ────────────────────────────────────────────────────────────────
const MonacoEditor = ({
  // Controlled mode
  value,
  onChange,
  // VFS mode
  vfsPath,
  // Common
  language,
  readOnly   = false,
  height     = '100%',
  disabled   = false,
  placeholder,
  onSave,
  editorRef: externalRef,
}) => {
  const isVfs = Boolean(vfsPath) && value === undefined;

  const [vfsValue,   setVfsValue]   = useState('');
  const [origValue,  setOrigValue]  = useState('');
  const [dirty,      setDirty]      = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');

  // Always-current refs (avoids stale closures in keyboard handlers)
  const vfsValueRef  = useRef(vfsValue);
  const origValueRef = useRef(origValue);
  const dirtyRef     = useRef(dirty);
  vfsValueRef.current  = vfsValue;
  origValueRef.current = origValue;
  dirtyRef.current     = dirty;

  const monacoEditorRef = useRef(null); // raw Monaco editor instance

  const resolvedLang  = language || (isVfs ? detectLang(vfsPath) : 'plaintext');
  const resolvedValue = isVfs ? vfsValue : (value ?? '');

  // VFS: load on path change
  useEffect(() => {
    if (!isVfs || !vfsPath) return;
    setLoading(true);
    setErr('');
    vfsFetch(`/api/vfs/read?path=${encodeURIComponent(vfsPath)}`)
      .then(r => r.ok
        ? r.text()
        : r.json().then(e => { throw new Error(e.error || r.statusText); })
      )
      .then(text => {
        setVfsValue(text);
        setOrigValue(text);
        setDirty(false);
      })
      .catch(e => setErr(`Load error: ${e.message}`))
      .finally(() => setLoading(false));
  }, [vfsPath, isVfs]);

  const handleChange = useCallback((val = '') => {
    if (isVfs) {
      setVfsValue(val);
      setDirty(val !== origValueRef.current);
    } else {
      onChange?.(val);
    }
  }, [isVfs, onChange]);

  // Save — reads from refs so keyboard shortcut always has fresh values
  const doSave = useCallback(async () => {
    if (!isVfs) { onSave?.(value, ''); return; }
    if (!dirtyRef.current) return;
    setSaving(true);
    setErr('');
    try {
      const r = await vfsFetch('/api/vfs/write', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ path: vfsPath, content: vfsValueRef.current }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(e.error || r.statusText);
      }
      onSave?.(vfsValueRef.current, origValueRef.current);
      setOrigValue(vfsValueRef.current);
      setDirty(false);
    } catch (e) {
      setErr(`Save error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [isVfs, vfsPath, value, onSave]);

  // Keep doSave ref fresh so the keyboard handler never goes stale
  const doSaveRef = useRef(doSave);
  useEffect(() => { doSaveRef.current = doSave; }, [doSave]);

  const doFormat = useCallback(() => {
    monacoEditorRef.current
      ?.getAction('editor.action.formatDocument')
      ?.run();
  }, []);

  const revealLine = useCallback((lineNumber) => {
    const ed = monacoEditorRef.current;
    if (!ed) return;
    ed.revealLineInCenter(lineNumber);
    ed.setPosition({ lineNumber, column: 1 });
    ed.focus();
  }, []);

  // Expose API via externalRef
  useEffect(() => {
    if (!externalRef) return;
    externalRef.current = {
      revealLine,
      format:  doFormat,
      save:    () => doSaveRef.current(),
      getOriginal: () => origValueRef.current,
      getValue:    () => vfsValueRef.current,
    };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height, opacity: disabled ? 0.45 : 1 }}>

      {/* Toolbar — only in VFS mode */}
      {isVfs && (
        <div className="mce-toolbar">
          <span className="mce-path" title={vfsPath}>
            {vfsPath?.split('/').pop() || vfsPath}
          </span>
          {dirty  && <span className="mce-dirty" title="Unsaved changes">●</span>}
          {err    && <span className="mce-err" title={err}>⚠ {err}</span>}
          <button className="mce-btn" onClick={doFormat}>Format</button>
          <button
            className={`mce-btn${dirty ? ' mce-save-active' : ''}`}
            onClick={doSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* Editor */}
      {loading ? (
        <div className="mce-loading">Loading…</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            language={resolvedLang}
            value={resolvedValue}
            theme="kuro-dark"
            onChange={handleChange}
            options={{
              ...EDITOR_OPTIONS,
              readOnly: readOnly || disabled,
              ...(placeholder ? { placeholder } : {}),
            }}
            beforeMount={ensureTheme}
            onMount={(editor, monaco) => {
              monacoEditorRef.current = editor;
              if (externalRef) {
                externalRef.current = {
                  revealLine,
                  format:      doFormat,
                  save:        () => doSaveRef.current(),
                  getOriginal: () => origValueRef.current,
                  getValue:    () => vfsValueRef.current,
                };
              }
              // Ctrl/Cmd+S → save
              editor.addCommand(
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                () => doSaveRef.current(),
              );
            }}
          />
        </div>
      )}
    </div>
  );
};

export default MonacoEditor;
