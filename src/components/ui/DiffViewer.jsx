/**
 * DiffViewer — KURO Phase 4
 *
 * Unified diff display using Monaco's built-in DiffEditor.
 * Shows original (on-disk) vs modified (in-editor) content.
 *
 * Props:
 *   filename   — display name in header
 *   language   — Monaco language id
 *   original   — original file content (string)
 *   modified   — modified file content (string)
 *   onAccept   — () => void — caller saves + closes diff
 *   onReject   — () => void — caller reverts + closes diff
 *   height     — CSS string, default '100%'
 */

import React from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Check, X } from 'lucide-react';
import { detectLang } from './MonacoEditor';

// Register kuro-dark theme for the diff editor (idempotent — Monaco accepts re-definitions)
function beforeMountDiff(monaco) {
  try {
    monaco.editor.defineTheme('kuro-dark', {
      base:    'vs-dark',
      inherit: true,
      rules:   [],
      colors: {
        'editor.background': '#09090e',
        'editor.foreground': '#dde1ec',
        'diffEditor.insertedTextBackground':       '#166534a0',
        'diffEditor.removedTextBackground':        '#7f1d1da0',
        'diffEditor.insertedLineBackground':       '#14532d40',
        'diffEditor.removedLineBackground':        '#7f1d1d40',
        'diffEditorGutter.insertedLineBackground': '#14532d80',
        'diffEditorGutter.removedLineBackground':  '#7f1d1d80',
      },
    });
  } catch { /* already defined — safe to ignore */ }
}

const DiffViewer = ({
  filename,
  language,
  original = '',
  modified = '',
  onAccept,
  onReject,
  height = '100%',
}) => {
  const resolvedLang = language || detectLang(filename || '');

  const origLines = (original || '').split('\n').length;
  const modLines  = (modified  || '').split('\n').length;
  const delta     = modLines - origLines;
  const deltaStr  = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0';
  const deltaClass = delta > 0 ? 'dv-add' : delta < 0 ? 'dv-rm' : 'dv-eq';

  return (
    <div className="dv-wrap" style={{ display: 'flex', flexDirection: 'column', height }}>

      {/* Header */}
      <div className="dv-header">
        <span className="dv-title">Changes</span>
        {filename && <span className="dv-filename">{filename.split('/').pop()}</span>}
        <span className={`dv-delta ${deltaClass}`}>{deltaStr} lines</span>
        <div style={{ flex: 1 }} />
        <button className="dv-btn dv-reject-btn" onClick={onReject} title="Discard — revert to original">
          <X size={12} /> Reject
        </button>
        <button className="dv-btn dv-accept-btn" onClick={onAccept} title="Accept — save file">
          <Check size={12} /> Accept
        </button>
      </div>

      {/* Monaco diff editor */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          height="100%"
          language={resolvedLang}
          original={original}
          modified={modified}
          theme="kuro-dark"
          options={{
            readOnly:             true,
            renderSideBySide:     false,
            fontSize:             13,
            lineHeight:           20,
            fontFamily:           "'SF Mono', 'Fira Code', monospace",
            minimap:              { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout:      true,
            padding:              { top: 8 },
            overviewRulerLanes:   0,
          }}
          beforeMount={beforeMountDiff}
        />
      </div>
    </div>
  );
};

export default DiffViewer;
