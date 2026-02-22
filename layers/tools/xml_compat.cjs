/**
 * KURO Phase 3 — XML Compatibility Layer
 *
 * Converts legacy XML tool tags in model output to formal kuro_tool_call envelopes.
 * If conversion fails, emits a TOOL_CONVERT_FAIL event and returns null (safe no-op).
 *
 * Mappings:
 *   <terminal>python main.py</terminal>  →  runner.spawn { cmd, lang }
 *   <file path="/foo.txt">...</file>     →  vfs.write   { path, content }
 *
 * Pass-through (text only — no execution):
 *   <plan>...</plan>
 *   <think>...</think>
 *
 * Feature flags:
 *   KURO_JSON_TOOLS_ONLY=true  → this module still PARSES legacy XML but
 *                                returns { blocked: true } instead of a call,
 *                                so the caller can reject execution.
 */

'use strict';

const crypto = require('crypto');

const JSON_TOOLS_ONLY =
  (process.env.KURO_JSON_TOOLS_ONLY ?? 'false').toLowerCase() === 'true';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a call ID (uuid-like) */
function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * Safe console event for failed conversions.
 */
function emitConvertFail(tag, content, reason) {
  console.error(
    `[TOOL_CONVERT_FAIL] tag=<${tag}> reason=${reason}`,
    content ? `content_preview=${content.slice(0, 80)}` : '',
  );
}

/**
 * Parse a <terminal> block into a runner.spawn call.
 * Input: raw text content, e.g. "python main.py" or "run node index.js"
 * Returns kuro_tool_call envelope or null.
 */
function parseTerminal(content) {
  if (!content || typeof content !== 'string') return null;

  const trimmed = content.trim();
  if (!trimmed) return null;

  // Tokenise — split on whitespace
  const tokens = trimmed.split(/\s+/);
  let lang = 'python';
  let cmd  = null;

  const first = tokens[0].toLowerCase();

  if (first === 'python' || first === 'python3') {
    lang = 'python';
    cmd  = tokens.slice(1).join(' ') || null;
  } else if (first === 'node' || first === 'nodejs') {
    lang = 'node';
    cmd  = tokens.slice(1).join(' ') || null;
  } else if (first === 'run' && tokens.length > 1) {
    const second = tokens[1].toLowerCase();
    if (second === 'python' || second === 'python3') {
      lang = 'python';
      cmd  = tokens.slice(2).join(' ') || null;
    } else if (second === 'node' || second === 'nodejs') {
      lang = 'node';
      cmd  = tokens.slice(2).join(' ') || null;
    } else {
      // e.g. "run main.py" — infer from extension
      cmd = tokens.slice(1).join(' ');
      lang = cmd.endsWith('.py') ? 'python' : cmd.endsWith('.js') ? 'node' : 'python';
    }
  } else {
    // Bare filename or unknown prefix — infer lang from extension
    cmd  = trimmed;
    lang = cmd.endsWith('.py') ? 'python' : cmd.endsWith('.js') ? 'node' : 'python';
  }

  if (!cmd) return null;

  // Strip any path components for safety (cmd must be filename only)
  const basename = cmd.split(/[/\\]/).pop();
  if (!basename) return null;

  return {
    kuro_tool_call: {
      id:   genId(),
      name: 'runner.spawn',
      args: { cmd: basename, lang },
    },
    _xml_source: 'terminal',
  };
}

/**
 * Parse a <file path="..."> block into a vfs.write call.
 */
function parseFile(attrs, content) {
  const path = attrs.path;
  if (!path || typeof path !== 'string') return null;
  if (!content || typeof content !== 'string') return null;

  // Safety: reject path traversal
  if (path.includes('..')) return null;

  return {
    kuro_tool_call: {
      id:   genId(),
      name: 'vfs.write',
      args: { path, content },
    },
    _xml_source: 'file',
  };
}

/**
 * Parse attribute string from an XML tag into a key→value map.
 * e.g. 'path="/foo.txt" type="text"' → { path: '/foo.txt', type: 'text' }
 */
function parseAttrs(attrStr) {
  const attrs = {};
  if (!attrStr) return attrs;
  const re = /(\w[\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? true;
  }
  return attrs;
}

/**
 * Extract all recognised XML tool blocks from a text string.
 * Returns array of { tag, attrs, content, raw, callEnvelope, blocked }.
 *
 * Unrecognised tags are ignored.
 * Parse errors are logged as TOOL_CONVERT_FAIL and omitted from results.
 */
function extractXmlBlocks(text) {
  if (!text || typeof text !== 'string') return [];

  const RECOGNISED_TAGS = ['terminal', 'file'];
  const PASS_THROUGH    = ['plan', 'think'];
  const results = [];

  // Match self-closing or paired tags for recognised + pass-through tags
  const allTags = [...RECOGNISED_TAGS, ...PASS_THROUGH].join('|');
  const tagRe   = new RegExp(
    `<(${allTags})([^>]*)>([\\s\\S]*?)<\\/\\1>`,
    'gi',
  );

  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const tag     = m[1].toLowerCase();
    const attrStr = m[2].trim();
    const content = m[3];
    const raw     = m[0];

    if (PASS_THROUGH.includes(tag)) {
      // Never executed — no tool call generated
      results.push({ tag, raw, callEnvelope: null, passThrough: true });
      continue;
    }

    let callEnvelope = null;
    let parseError   = null;

    try {
      if (tag === 'terminal') {
        callEnvelope = parseTerminal(content);
        if (!callEnvelope) parseError = 'empty or unrecognised terminal content';
      } else if (tag === 'file') {
        const attrs  = parseAttrs(attrStr);
        callEnvelope = parseFile(attrs, content);
        if (!callEnvelope) parseError = 'missing path attr or content';
      }
    } catch (e) {
      parseError = e.message;
    }

    if (parseError) {
      emitConvertFail(tag, content, parseError);
      results.push({ tag, raw, callEnvelope: null, blocked: false, error: parseError });
      continue;
    }

    // Apply KURO_JSON_TOOLS_ONLY flag
    if (JSON_TOOLS_ONLY && callEnvelope) {
      results.push({ tag, raw, callEnvelope, blocked: true });
      continue;
    }

    results.push({ tag, raw, callEnvelope, blocked: false });
  }

  return results;
}

/**
 * Convert a single XML block (tag + content + attrs) to a tool call envelope.
 * Convenience wrapper around parseTerminal / parseFile.
 * Returns { callEnvelope, blocked } or null if conversion failed.
 */
function convertXmlToToolCall(tag, content, attrs = {}) {
  try {
    let callEnvelope = null;
    if (tag === 'terminal') callEnvelope = parseTerminal(content);
    else if (tag === 'file') callEnvelope = parseFile(attrs, content);

    if (!callEnvelope) {
      emitConvertFail(tag, content, 'conversion returned null');
      return null;
    }
    return { callEnvelope, blocked: JSON_TOOLS_ONLY };
  } catch (e) {
    emitConvertFail(tag, content, e.message);
    return null;
  }
}

module.exports = { extractXmlBlocks, convertXmlToToolCall, JSON_TOOLS_ONLY };
