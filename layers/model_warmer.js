/**
 * KURO::MODEL WARMER v1.0 — Predictive Model Pre-Loading
 * 
 * Commercial AI has static model loading. KURO predicts which model
 * you'll need and pre-loads it before you finish typing.
 * 
 * Mechanism:
 *   1. Semantic router detects intent from partial input (via preempt)
 *   2. Intent → skill → model mapping (SKILL_MODELS)
 *   3. Warm the target model with a zero-token Ollama call (loads into VRAM)
 *   4. When the real request arrives, model is already hot
 * 
 * With OLLAMA_KEEP_IN_RAM=true (A1), warmed models stay in system RAM
 * even after VRAM eviction. Re-warming from RAM = ~1.5s vs disk = ~12s.
 * 
 * Constraints:
 *   - Only 1 model in VRAM at a time on L4 (24GB, 24B model = 20GB)
 *   - Don't evict a model that's currently streaming
 *   - Cooldown: don't warm the same model within 30s
 *   - Only warm if confident in intent (semantic score > 0.7)
 * 
 * v7.0.2b — Extracted from Gemini "Predictive Model Paging" + "Skill Chips"
 */

const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const WARM_COOLDOWN_MS = 30000;   // Don't re-warm same model within 30s
const WARM_TIMEOUT_MS = 5000;     // Abort warming if takes too long
const WARM_KEEP_ALIVE = '5m';     // Keep warmed model loaded for 5 minutes

// Intent → model mapping (mirrors SKILL_MODELS from server.cjs — v7.0.3 2-model architecture)
const INTENT_MODEL_MAP = {
  code:        'kuro-core',
  dev:         'kuro-core',
  reasoning:   'kuro-core',
  research:    'kuro-core',
  analysis:    'kuro-core',
  vision:      'kuro-core',
  image:       'kuro-core',
  crypto:      'kuro-core',
  security:    'kuro-core',
  stealth:     'kuro-core',
  opsec:       'kuro-core',
  fast:        'kuro-core',
  triage:      'kuro-core',
  chat:        'kuro-core',
  general:     'kuro-core',
  creative:    'kuro-core',
  unrestricted:'kuro-core',
  exec:        'kuro-core'
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const _warmState = {
  lastWarmed: {},       // { modelId: timestamp }
  currentlyWarming: null,
  isStreaming: false,    // Set by stream handler to prevent eviction
  stats: { attempts: 0, hits: 0, skipped: 0, errors: 0 }
};

// ═══════════════════════════════════════════════════════════════════════════
// INTENT DETECTION (lightweight — for partial input)
// ═══════════════════════════════════════════════════════════════════════════

// Keyword patterns for quick intent detection from partial typing
const INTENT_PATTERNS = {
  code:      /\b(function|class|import|export|const |let |var |def |async |react|component|api|endpoint|bug|fix|refactor|implement)\b/i,
  vision:    /\b(image|picture|photo|generate|draw|design|visual|flux|dall|render|illustration)\b/i,
  reasoning: /\b(why|explain|analyze|compare|prove|derive|logic|reason|think|consider)\b/i,
  crypto:    /\b(encrypt|decrypt|hash|cipher|ssl|tls|certificate|key|token|jwt|auth)\b/i,
  stealth:   /\b(vpn|proxy|tor|opsec|privacy|anonymous|hidden|shadow|tunnel)\b/i,
  fast:      /\b(quick|fast|brief|tl;?dr|summary|short|one.?line)\b/i
};

function detectIntentFromPartial(partialInput) {
  if (!partialInput || partialInput.length < 5) return null;

  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(partialInput)) {
      return { intent, confidence: 0.75, source: 'pattern' };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL WARMING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Warm a model by sending a minimal Ollama request.
 * This loads the model into VRAM (or keeps it in RAM if already cached).
 */
async function warmModel(modelId, ollamaModelName) {
  // Don't warm if streaming
  if (_warmState.isStreaming) {
    _warmState.stats.skipped++;
    return { warmed: false, reason: 'stream_active' };
  }

  // Cooldown check
  const lastWarm = _warmState.lastWarmed[modelId] || 0;
  if (Date.now() - lastWarm < WARM_COOLDOWN_MS) {
    _warmState.stats.skipped++;
    return { warmed: false, reason: 'cooldown' };
  }

  // Don't double-warm
  if (_warmState.currentlyWarming === modelId) {
    _warmState.stats.skipped++;
    return { warmed: false, reason: 'already_warming' };
  }

  _warmState.currentlyWarming = modelId;
  _warmState.stats.attempts++;

  try {
    // Minimal request — just loads the model, generates nothing useful
    await axios.post(`${OLLAMA_URL}/api/chat`, {
      model: ollamaModelName,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      keep_alive: WARM_KEEP_ALIVE,
      options: { num_predict: 1 }  // Generate just 1 token — fast
    }, { timeout: WARM_TIMEOUT_MS });

    _warmState.lastWarmed[modelId] = Date.now();
    _warmState.stats.hits++;
    return { warmed: true, model: modelId };
  } catch (e) {
    _warmState.stats.errors++;
    return { warmed: false, reason: e.message };
  } finally {
    _warmState.currentlyWarming = null;
  }
}

/**
 * Main entry: detect intent from partial input and pre-warm the model.
 * Called by preempt engine or debounced input handler.
 */
async function predictiveWarm(partialInput, modelRegistry) {
  const intent = detectIntentFromPartial(partialInput);
  if (!intent) return { action: 'none', reason: 'no_intent_detected' };

  const targetModelId = INTENT_MODEL_MAP[intent.intent];
  if (!targetModelId) return { action: 'none', reason: 'no_model_for_intent' };

  const modelConfig = modelRegistry?.[targetModelId];
  if (!modelConfig) return { action: 'none', reason: 'model_not_in_registry' };

  const result = await warmModel(targetModelId, modelConfig.ollama);
  return {
    action: result.warmed ? 'warmed' : 'skipped',
    intent: intent.intent,
    model: targetModelId,
    confidence: intent.confidence,
    ...result
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STREAM LOCK — prevent warming during active inference
// ═══════════════════════════════════════════════════════════════════════════

function setStreaming(active) {
  _warmState.isStreaming = active;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════

function warmStats() {
  return {
    ..._warmState.stats,
    currentlyWarming: _warmState.currentlyWarming,
    isStreaming: _warmState.isStreaming,
    lastWarmed: Object.entries(_warmState.lastWarmed).map(([model, ts]) => ({
      model,
      ago: Math.round((Date.now() - ts) / 1000) + 's'
    }))
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS ROUTE (optional — for debugging)
// ═══════════════════════════════════════════════════════════════════════════

function mountWarmerRoutes(app) {
  app.get('/api/warmer/stats', (req, res) => {
    res.json(warmStats());
  });

  app.post('/api/warmer/warm', async (req, res) => {
    const { input, modelRegistry } = req.body;
    const result = await predictiveWarm(input, modelRegistry);
    res.json(result);
  });

  console.log('[WARMER] Routes mounted: /api/warmer/{stats,warm}');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  predictiveWarm,
  warmModel,
  detectIntentFromPartial,
  setStreaming,
  warmStats,
  mountWarmerRoutes,
  INTENT_MODEL_MAP,
  INTENT_PATTERNS
};
