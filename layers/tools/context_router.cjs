/**
 * KURO Context Router v1.0
 * Maps agent intent → relevant context pack sections.
 *
 * Usage:
 *   const { routeContext } = require('./layers/tools/context_router.cjs');
 *   const { intent, combined } = routeContext('how does VFS auth work?');
 */

const path = require('path');
const fs   = require('fs');

const DOCS_DIR = path.join(__dirname, '../../docs');

// Intent → relative doc file list (resolved from DOCS_DIR)
const INTENT_MAP = {
  auth:       ['ARCHITECTURE.md', 'INTERFACES.md'],
  vfs:        ['INTERFACES.md', 'PHASES.md', 'generated/DB.md'],
  sandbox:    ['generated/SANDBOX.md', 'ARCHITECTURE.md'],
  security:   ['SECURITY.md'],
  agent:      ['generated/TOOLS.md', 'generated/LAYERS.md'],
  tools:      ['generated/TOOLS.md'],
  layers:     ['generated/LAYERS.md'],
  database:   ['generated/DB.md'],
  routes:     ['generated/ROUTES.md', 'INTERFACES.md'],
  phases:     ['PHASES.md'],
  general:    ['ARCHITECTURE.md'],
};

// Keyword → intent classification
const INTENT_PATTERNS = [
  [/\b(login|logout|session|oauth|token|password|auth(?:entication|orization)?)\b/i, 'auth'],
  [/\b(file|upload|download|vfs|director(?:y|ies)|mkdir|s3|storage|bucket|quota)\b/i, 'vfs'],
  [/\b(sandbox|docker|firejail|exec(?:ute)?|run|python|isolat)\b/i,                   'sandbox'],
  [/\b(security|csp|xss|traversal|inject|csrf|rate.?limit|exploit)\b/i,              'security'],
  [/\b(agent|orchestrat|tool\b|connector|capability|pipeline)\b/i,                    'agent'],
  [/\b(layer|L[0-9]+\b|stream\s+pipe)\b/i,                                            'layers'],
  [/\b(database|sqlite|schema|table|migration|db\b)\b/i,                              'database'],
  [/\b(route|endpoint|api\b|rest|http\s+method)\b/i,                                  'routes'],
  [/\b(phase|roadmap|plan|milestone|backlog)\b/i,                                     'phases'],
];

/**
 * Classify a free-form query string into an intent key.
 * @param {string} query
 * @returns {string} intent key
 */
function classifyIntent(query) {
  const q = String(query || '');
  for (const [re, intent] of INTENT_PATTERNS) {
    if (re.test(q)) return intent;
  }
  return 'general';
}

/**
 * Load context sections for a given intent key.
 * Returns array of { file, content } objects.
 * Missing docs return a placeholder message (run gen_context_pack.cjs first).
 * @param {string} intent
 * @returns {{ file: string, content: string }[]}
 */
function loadContext(intent) {
  const files = INTENT_MAP[intent] || INTENT_MAP.general;
  return files.map(rel => {
    const fp = path.join(DOCS_DIR, rel);
    try {
      return { file: rel, content: fs.readFileSync(fp, 'utf8') };
    } catch {
      return { file: rel, content: `[Not yet generated — run: node scripts/gen_context_pack.cjs]` };
    }
  });
}

/**
 * Main entry: classify query, load docs, return combined context string.
 * @param {string} query
 * @returns {{ intent: string, sections: {file,content}[], combined: string }}
 */
function routeContext(query) {
  const intent   = classifyIntent(query);
  const sections = loadContext(intent);
  const combined = sections
    .map(s => `## ${s.file}\n\n${s.content}`)
    .join('\n\n---\n\n');
  return { intent, sections, combined };
}

module.exports = { classifyIntent, loadContext, routeContext, INTENT_MAP };
