/**
 * KURO::VISION — Orchestrator
 * 
 * Main pipeline controller. Coordinates:
 *   1. Intent classification → pipeline selection
 *   2. GPU 1 concurrency lock
 *   3. Scene graph generation via kuro-eye
 *   4. Image generation via FLUX sidecar (port 3200)
 *   5. Text compositing (if text pipeline)
 *   6. Binary evaluation via kuro-eye
 *   7. Optional rerender (max 2 attempts)
 *   8. Storage + GPU 1 release
 * 
 * Streams SSE events for each phase (latency weaponization).
 * 
 * v6.3 compliance:
 *   - All writes to /var/lib/kuro/vision/
 *   - Every job audited with requestId, models, seed, timing, pass/fail
 *   - GPU 1 concurrency lock prevents parallel vision jobs
 *   - Profile-based retention
 */

const crypto = require('crypto');
const axios = require('axios');

const gpuMutex = require('./vision_gpu_mutex.cjs');
const { classifyIntent } = require('./vision_intent.cjs');
const { generateSceneGraph } = require('./vision_scene_graph.cjs');
const { evaluate, buildRefinementPrompt } = require('./vision_evaluator.cjs');
const storage = require('./vision_storage.cjs');

const FLUX_URL = process.env.FLUX_URL || 'http://localhost:3200';
const MAX_RERENDERS = 2;

// A2: FLUX dual mode — schnell (interactive) vs dev (production)
// schnell: 4 steps, ~8GB VRAM, fast (~3s on 5090). Scout can stay loaded alongside.
// dev: 28 steps, ~12GB VRAM, quality (~15s on 5090). Requires full GPU eviction.
const FLUX_MODES = {
  schnell: { steps: 4, guidance: 0, maxDim: 1024, label: 'Fast', vramEstimate: 8 },
  dev:     { steps: 28, guidance: 3.5, maxDim: 1024, label: 'Quality', vramEstimate: 12 }
};

function resolveFluxMode(requestedMode, userTier) {
  // Sovereign users can choose. Everyone else gets schnell.
  if (requestedMode === 'dev' && userTier === 'sovereign') return 'dev';
  return 'schnell';
}

// ─── SSE Helper ──────────────────────────────────────────────────────────

function sse(res, data) {
  try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
}

// ─── Main Pipeline ───────────────────────────────────────────────────────

async function generate(req, res, auditFn) {
  const requestId = crypto.randomUUID();
  const t0 = Date.now();
  const {
    prompt,
    sessionId,
    profile = 'lab',
    seed,
    width,
    height,
    aspect_ratio,
    preset     = 'draft',
    n          = 1,
    negative_prompt,
    steps: requestedSteps,
    guidance_scale: requestedGuidance,
    fluxMode: requestedFlux,
    userTier = 'free'
  } = req.body;

  // A2: Resolve FLUX mode — schnell default, dev for sovereign on request
  const fluxMode = resolveFluxMode(requestedFlux, userTier);
  const fluxCfg = FLUX_MODES[fluxMode];
  const steps = requestedSteps || fluxCfg.steps;
  const guidanceScale = requestedGuidance != null ? requestedGuidance : fluxCfg.guidance;

  if (!prompt?.trim()) {
    sse(res, { type: 'error', message: 'Empty prompt' });
    sse(res, { type: 'done' });
    return;
  }

  // Load existing session for edits
  const session = sessionId ? storage.loadSession(sessionId) : null;
  const existingGraph = session?.lastGraph || null;

  // ── Phase 1: Intent Classification ─────────────────────────────────
  sse(res, { type: 'vision_phase', phase: 'intent', status: 'active', label: 'Analyzing request...' });

  const intent = classifyIntent(prompt, !!existingGraph);

  sse(res, {
    type: 'vision_phase', phase: 'intent', status: 'complete',
    data: {
      pipeline: intent.pipeline,
      confidence: intent.confidence,
      reason: intent.reason,
      textSegments: intent.textSegments,
      skipFeedback: intent.skipFeedbackLoop,
      fluxMode, fluxSteps: steps, fluxGuidance: guidanceScale
    }
  });

  // ── Phase 2: GPU Acquisition ───────────────────────────────────────
  sse(res, { type: 'vision_phase', phase: 'gpu', status: 'active', label: 'Locking vision GPU...' });

  const gpuResult = await gpuMutex.acquire(requestId, auditFn);

  if (!gpuResult.acquired) {
    sse(res, {
      type: 'vision_phase', phase: 'gpu', status: 'blocked',
      data: { reason: gpuResult.reason }
    });
    sse(res, { type: 'error', message: `GPU busy: ${gpuResult.reason}` });
    sse(res, { type: 'done' });
    return;
  }

  sse(res, {
    type: 'vision_phase', phase: 'gpu', status: 'complete',
    data: { gpu: gpuResult.gpu, mode: gpuResult.mode }
  });

  try {
    // ── Phase 3: Scene Graph ───────────────────────────────────────
    let sceneGraph = null;

    if (intent.pipeline !== 'simple' || !intent.skipFeedbackLoop) {
      sse(res, { type: 'vision_phase', phase: 'scene_graph', status: 'active', label: 'Planning composition...' });

      const sgResult = await generateSceneGraph(prompt, intent, existingGraph);
      sceneGraph = sgResult.graph;

      sse(res, {
        type: 'vision_phase', phase: 'scene_graph', status: 'complete',
        data: {
          objects: sceneGraph.objects?.length || 0,
          textBoxes: sceneGraph.text_boxes?.length || 0,
          style: sceneGraph.style,
          fallback: sgResult.fallback || false
        }
      });
    } else {
      // Simple pipeline — minimal graph
      sceneGraph = {
        diffusion_prompt: prompt,
        negative_prompt: 'blurry, low quality, distorted, deformed',
        dimensions: { width, height },
        objects: [],
        text_boxes: [],
        _text_boxes_px: []
      };
    }

    // ── Phase 4: Image Generation ──────────────────────────────────
    let currentPrompt = sceneGraph.diffusion_prompt;
    let finalImage = null;
    let finalMeta = null;
    let evalResult = null;
    let attempt = 0;

    while (attempt <= MAX_RERENDERS) {
      attempt++;
      const isRetry = attempt > 1;

      sse(res, {
        type: 'vision_phase', phase: 'generate',
        status: 'active',
        label: isRetry ? `Re-rendering (attempt ${attempt})...` : 'Generating image...',
        data: { attempt, steps }
      });

      let genResult;
      // Emit progress ticks every 2s while FLUX is running (prevents dead air)
      let genTick = 0;
      const genInterval = setInterval(() => {
        genTick++;
        const pct = Math.min(40 + genTick * 4, 90);
        sse(res, { type: 'vision_progress', jobId: requestId, pct, stage: 'generate', elapsed: Math.round((Date.now() - t0) / 1000) });
      }, 2000);
      try {
        const { data } = await axios.post(`${FLUX_URL}/generate`, {
          prompt:          currentPrompt,
          negative_prompt: negative_prompt || sceneGraph.negative_prompt || '',
          preset,
          aspect_ratio:    aspect_ratio,
          width:           width  || sceneGraph.dimensions?.width,
          height:          height || sceneGraph.dimensions?.height,
          n:               n || 1,
          steps,
          guidance_scale:  guidanceScale,
          seed:            isRetry ? undefined : seed,
          request_id:      requestId
        }, { timeout: 300000 });

        genResult = data;
      } catch (e) {
        clearInterval(genInterval);
        sse(res, { type: 'vision_phase', phase: 'generate', status: 'error', data: { error: e.message } });
        throw new Error(`FLUX generation failed: ${e.message}`);
      }
      clearInterval(genInterval);

      if (!genResult.success) {
        sse(res, { type: 'vision_phase', phase: 'generate', status: 'error', data: { error: genResult.error } });
        throw new Error(`FLUX error: ${genResult.error}`);
      }

      sse(res, {
        type: 'vision_phase', phase: 'generate', status: 'complete',
        data: {
          attempt,
          elapsed: genResult.elapsed,
          seed: genResult.seed,
          dimensions: genResult.dimensions
        }
      });

      finalImage = genResult;
      finalMeta = {
        requestId,
        prompt: currentPrompt,
        seed: genResult.seed,
        steps,
        dimensions: genResult.dimensions,
        elapsed: genResult.elapsed,
        attempt,
        pipeline: intent.pipeline
      };

      // ── Phase 4b: Text Compositing ─────────────────────────────
      if (intent.pipeline === 'text' && sceneGraph._text_boxes_px?.length > 0) {
        sse(res, { type: 'vision_phase', phase: 'composite', status: 'active', label: 'Rendering text...' });

        try {
          const { data: compResult } = await axios.post(`${FLUX_URL}/composite-text`, {
            image_base64: genResult.base64,
            text_boxes: sceneGraph._text_boxes_px,
            request_id: requestId
          }, { timeout: 30000 });

          if (compResult.success) {
            finalImage = { ...finalImage, base64: compResult.base64, path: compResult.path, hash: compResult.hash };
            sse(res, { type: 'vision_phase', phase: 'composite', status: 'complete', data: { textsRendered: sceneGraph._text_boxes_px.length } });
          } else {
            sse(res, { type: 'vision_phase', phase: 'composite', status: 'warning', data: { reason: compResult.error } });
          }
        } catch (e) {
          sse(res, { type: 'vision_phase', phase: 'composite', status: 'warning', data: { reason: e.message } });
          // Continue without text — image still usable
        }
      }

      // ── Phase 5: Evaluation ──────────────────────────────────────
      if (intent.skipFeedbackLoop && attempt === 1) {
        // High-confidence simple prompt — skip eval
        sse(res, { type: 'vision_phase', phase: 'evaluate', status: 'skipped', data: { reason: 'High confidence simple prompt' } });
        evalResult = { passed: true, results: {}, failReasons: [] };
        break;
      }

      sse(res, { type: 'vision_phase', phase: 'evaluate', status: 'active', label: 'Evaluating result...' });

      evalResult = await evaluate(finalImage.path, sceneGraph);

      // Stream checklist in real time
      for (const [check, result] of Object.entries(evalResult.results)) {
        sse(res, {
          type: 'vision_check',
          check,
          status: result.status,
          reason: result.reason
        });
      }

      sse(res, {
        type: 'vision_phase', phase: 'evaluate', status: 'complete',
        data: {
          passed: evalResult.passed,
          failCount: evalResult.failReasons.length,
          attempt
        }
      });

      if (evalResult.passed || attempt > MAX_RERENDERS) {
        break;
      }

      // Refine prompt for retry
      currentPrompt = buildRefinementPrompt(currentPrompt, evalResult);
    }

    // ── Phase 6: Storage ───────────────────────────────────────────
    sse(res, { type: 'vision_phase', phase: 'storage', status: 'active', label: 'Saving...' });

    // Save session state for edits
    const sessionState = {
      lastGraph: sceneGraph,
      lastImage: finalImage.filename,
      lastSeed: finalImage.seed || finalMeta.seed,
      history: [
        ...(session?.history || []),
        { prompt, timestamp: Date.now(), image: finalImage.filename }
      ]
    };
    const sid = sessionId || requestId;
    storage.saveSession(sid, sessionState);

    // Run cleanup based on profile
    storage.cleanup(profile);

    sse(res, { type: 'vision_phase', phase: 'storage', status: 'complete' });

    // ── Final: Send Image ──────────────────────────────────────────
    sse(res, {
      type:       'vision_result',
      image:      finalImage.base64,
      filename:   finalImage.filename,
      hash:       finalImage.hash,
      seed:       finalMeta.seed,
      dimensions: finalMeta.dimensions,
      elapsed:    Math.round((Date.now() - t0) / 1000),
      attempts:   attempt,
      pipeline:   intent.pipeline,
      preset:     preset,
      n:          finalImage.images ? finalImage.images.length : 1,
      images:     finalImage.images || null,
      evaluation: evalResult ? {
        passed: evalResult.passed,
        checks: evalResult.results
      } : null,
      sessionId: sid
    });

    // Audit entry
    if (auditFn) {
      auditFn({
        agent: 'vision',
        action: 'generate',
        result: evalResult?.passed ? 'success' : 'partial',
        meta: {
          requestId,
          prompt: prompt.slice(0, 200),
          pipeline: intent.pipeline,
          seed: finalMeta.seed,
          steps,
          dimensions: finalMeta.dimensions,
          elapsed: Date.now() - t0,
          attempts: attempt,
          evaluation: evalResult?.results ? Object.fromEntries(
            Object.entries(evalResult.results).map(([k, v]) => [k, v.status])
          ) : {},
          artifactPath: finalImage.path,
          artifactHash: finalImage.hash
        }
      });
    }

  } catch (err) {
    sse(res, { type: 'error', message: err.message });

    if (auditFn) {
      auditFn({
        agent: 'vision',
        action: 'generate',
        result: 'error',
        meta: { requestId, error: err.message, elapsed: Date.now() - t0 }
      });
    }
  } finally {
    // ── Always release GPU ─────────────────────────────────────────
    sse(res, { type: 'vision_phase', phase: 'gpu_release', status: 'active', label: 'Releasing vision GPU...' });
    await gpuMutex.release(requestId, auditFn);
    sse(res, { type: 'vision_phase', phase: 'gpu_release', status: 'complete' });
    sse(res, { type: 'done' });
  }
}

module.exports = { generate };
