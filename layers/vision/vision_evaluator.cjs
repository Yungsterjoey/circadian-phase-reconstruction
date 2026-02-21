/**
 * KURO::VISION — Evaluator (Binary Tests)
 * 
 * RT-05 fix: Switches from fuzzy 1-10 scoring to binary pass/fail.
 * Each check gets: PASS/FAIL + one-line reason.
 * Only rerenders on required check failures. Max 2 rerenders.
 * 
 * v6.3 compliance: Uses Ollama HTTP API, no exec. Results logged to audit.
 */

const axios = require('axios');
const fs = require('fs');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const KURO_EYE = 'huihui_ai/qwen3-vl-abliterated:30b-a3b-instruct-q4_K_M';

// ─── Binary Check Definitions ────────────────────────────────────────────

const CHECKS = {
  has_required_subject: {
    required: true,
    prompt: (graph) => {
      if (!graph.objects?.length && !graph.diffusion_prompt) return null;
      const subjects = graph.objects?.map(o => o.label).join(', ') || graph.diffusion_prompt;
      return `Does this image contain: ${subjects}? Answer ONLY "PASS" or "FAIL" followed by one sentence reason.`;
    }
  },

  text_legible: {
    required: true,
    prompt: (graph) => {
      if (!graph.text_boxes?.length) return null; // Skip if no text expected
      const texts = graph.text_boxes.map(t => `"${t.text}"`).join(', ');
      return `Can you read these texts clearly in the image: ${texts}? Answer ONLY "PASS" (all readable) or "FAIL" (any illegible/missing) followed by one sentence reason.`;
    }
  },

  lighting_direction_match: {
    required: false,
    prompt: (graph) => {
      if (!graph.lighting?.direction) return null;
      return `Is the main light source coming from the ${graph.lighting.direction}? Answer ONLY "PASS" or "FAIL" followed by one sentence reason.`;
    }
  },

  style_match: {
    required: false,
    prompt: (graph) => {
      if (!graph.style) return null;
      return `Does this image match the style "${graph.style}"? Answer ONLY "PASS" or "FAIL" followed by one sentence reason.`;
    }
  },

  no_artifacts: {
    required: true,
    prompt: () => `Are there obvious visual artifacts, distortions, or mangled body parts? Answer ONLY "PASS" (clean image) or "FAIL" (has artifacts) followed by one sentence reason.`
  }
};

// ─── Run Evaluation ──────────────────────────────────────────────────────

async function evaluate(imagePath, sceneGraph) {
  const results = {};
  let allRequiredPassed = true;
  const failReasons = [];

  // Read image as base64
  let imageB64;
  try {
    const imgBuf = fs.readFileSync(imagePath);
    imageB64 = imgBuf.toString('base64');
  } catch (e) {
    return {
      passed: false,
      results: { _error: { status: 'ERROR', reason: `Cannot read image: ${e.message}` } },
      failReasons: ['Image file unreadable'],
      shouldRerender: false
    };
  }

  for (const [checkName, checkDef] of Object.entries(CHECKS)) {
    const promptText = checkDef.prompt(sceneGraph);

    // Skip inapplicable checks
    if (promptText === null) {
      results[checkName] = { status: 'SKIPPED', reason: 'Not applicable' };
      continue;
    }

    try {
      const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
        model: KURO_EYE,
        messages: [{
          role: 'user',
          content: promptText,
          images: [imageB64]
        }],
        stream: false,
        options: { temperature: 0.1, num_predict: 80 }
      }, { timeout: 25000 });

      const raw = (data.message?.content || '').trim();
      const passed = raw.toUpperCase().startsWith('PASS');
      const reason = raw.replace(/^(?:PASS|FAIL)\s*/i, '').trim();

      results[checkName] = {
        status: passed ? 'PASS' : 'FAIL',
        reason: reason || (passed ? 'OK' : 'Failed'),
        raw
      };

      if (!passed && checkDef.required) {
        allRequiredPassed = false;
        failReasons.push(`${checkName}: ${reason}`);
      }
    } catch (e) {
      results[checkName] = { status: 'ERROR', reason: e.message };
      // Don't block on eval errors — ship what we have
    }
  }

  return {
    passed: allRequiredPassed,
    results,
    failReasons,
    shouldRerender: !allRequiredPassed,
    refinementHints: failReasons.length > 0
      ? `Fix these issues: ${failReasons.join('; ')}`
      : null
  };
}

// ─── Build Refined Prompt ────────────────────────────────────────────────

function buildRefinementPrompt(originalPrompt, evaluation) {
  if (!evaluation.refinementHints) return originalPrompt;
  return `${originalPrompt}\n\nIMPORTANT CORRECTIONS: ${evaluation.refinementHints}`;
}

module.exports = { evaluate, buildRefinementPrompt, CHECKS };
