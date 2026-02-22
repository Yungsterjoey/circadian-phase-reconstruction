/**
 * StackTrace — KURO Phase 4
 *
 * Parses runner stderr/stdout for file:line references and renders them
 * as clickable links. Clicking navigates the Monaco editor to that file + line.
 *
 * Supported patterns:
 *   Python  — File "main.py", line 42, in function_name
 *             File "/abs/path/to/main.py", line 42
 *   Node.js — at Something (/abs/path/file.js:42:8)
 *             at /abs/path/file.js:42:8
 *   Generic — filename.ext:lineNumber (at start of word boundary)
 *
 * Props:
 *   text       — raw output string (stdout or stderr)
 *   lang       — 'python' | 'node' | '' (influences parse priority)
 *   onNavigate — (filename: string, line: number) => void
 *   className  — extra CSS class for the <pre>
 */

import React, { useMemo } from 'react';

// ── Patterns ─────────────────────────────────────────────────────────────────

// Python: File "path/to/file.py", line 42
const RE_PYTHON = /File "([^"]+)", line (\d+)/g;

// Node.js: at Name (/path/file.js:42:8) or at /path/file.js:42:8
const RE_NODE = /at (?:[^(]+\s\()?([^\s()]+\.(js|ts|mjs|cjs|jsx|tsx)):(\d+):\d+\)?/g;

// Generic: word/file.ext:lineNumber  (catches remaining patterns)
const RE_GENERIC = /\b([a-zA-Z0-9_./-]+\.(py|js|ts|mjs|jsx|tsx|cjs)):(\d+)\b/g;

/**
 * Split `text` into an array of segments:
 *   { type: 'text',  value: string }
 *   { type: 'link',  value: string, file: string, line: number }
 */
function parseStackTrace(text) {
  if (!text) return [{ type: 'text', value: '' }];

  const segments = [];
  const matches  = [];

  // Collect all matches with their positions
  const collect = (re, getFile, getLine) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const file = getFile(m);
      const line = parseInt(getLine(m), 10);
      if (!file || isNaN(line)) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, file, line, raw: m[0] });
    }
  };

  collect(RE_PYTHON,  m => m[1], m => m[2]);
  collect(RE_NODE,    m => m[1], m => m[3]);
  collect(RE_GENERIC, m => m[1], m => m[3]);

  if (matches.length === 0) return [{ type: 'text', value: text }];

  // Sort by position, deduplicate overlapping matches (keep longest)
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const deduped = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start < lastEnd) continue; // overlaps previous — skip
    deduped.push(m);
    lastEnd = m.end;
  }

  // Build segments
  let pos = 0;
  for (const m of deduped) {
    if (m.start > pos) segments.push({ type: 'text', value: text.slice(pos, m.start) });
    // Use the basename for display + navigation
    const basename = m.file.split('/').pop() || m.file;
    segments.push({ type: 'link', value: m.raw, file: basename, line: m.line });
    pos = m.end;
  }
  if (pos < text.length) segments.push({ type: 'text', value: text.slice(pos) });

  return segments;
}

const StackTrace = ({ text, lang: _lang, onNavigate, className = '' }) => {
  const segments = useMemo(() => parseStackTrace(text), [text]);

  return (
    <pre className={`st-pre ${className}`}>
      {segments.map((seg, i) =>
        seg.type === 'link' ? (
          <button
            key={i}
            className="st-link"
            onClick={() => onNavigate?.(seg.file, seg.line)}
            title={`Open ${seg.file} at line ${seg.line}`}
          >
            {seg.value}
          </button>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </pre>
  );
};

export default StackTrace;
