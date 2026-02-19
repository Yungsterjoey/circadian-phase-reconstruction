/**
 * KURO::PREEMPT v2 — Stream Integration
 * 
 * RT-04: No continuation prompt. Instead:
 *   1. Flush cached tokens as instant head-start
 *   2. Start FRESH full inference in parallel
 *   3. Server-side dedup: skip live tokens that match buffer
 *   4. Seamless transition at the divergence point
 * 
 * This eliminates the "Continue from where you left off" quality drop.
 * The model generates a complete, coherent response from scratch.
 * User just sees it start instantly because the first N tokens are cached.
 * 
 * INSERT this into your /api/stream handler after layer pipeline.
 */

/**
 * Drop-in handler: wraps the preempt claim + fresh inference logic.
 * Call this instead of directly POSTing to Ollama.
 * 
 * @param {object} params
 * @param {object} params.req - Express request
 * @param {object} params.res - Express response (SSE headers already set)
 * @param {string} params.sessionId
 * @param {string} params.userMessage - final user message
 * @param {array}  params.chatMessages - full message array for Ollama
 * @param {object} params.model - { name, ctx }
 * @param {string} params.ollamaUrl
 * @param {object} params.ollamaOptions - temperature, num_ctx overrides
 */
async function streamWithPreempt({ req, res, sessionId, userMessage, chatMessages, model, ollamaUrl, ollamaOptions }) {
  const preemptEngine = require('./preempt_engine.cjs');
  const axios = require('axios');

  const OLLAMA = ollamaUrl || 'http://localhost:11434';
  let totalTokens = 0;

  // ═══ PHASE 1: Check for cached speculation ═══
  const claimed = preemptEngine.claim(sessionId, userMessage);

  if (claimed && claimed.tokenCount > 0) {
    // RT-05: buffer is already a snapshot (safe to iterate)

    // Tell client we're flushing cached tokens
    res.write(`data: ${JSON.stringify({
      type: 'preempt_start',
      buffered: claimed.tokenCount
    })}\n\n`);

    // Flush at wire speed with micro-delays for smooth rendering
    for (let i = 0; i < claimed.buffer.length; i++) {
      res.write(`data: ${JSON.stringify({
        type: 'token',
        content: claimed.buffer[i],
        preempted: true
      })}\n\n`);
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 2));
    }

    totalTokens = claimed.tokenCount;

    res.write(`data: ${JSON.stringify({
      type: 'preempt_end',
      flushed: claimed.tokenCount
    })}\n\n`);

    // RT-04: If speculation completed the FULL response, done.
    if (claimed.status === 'done') {
      res.write(`data: ${JSON.stringify({
        type: 'done',
        preempted: true,
        tokens: totalTokens
      })}\n\n`);
      res.end();
      return;
    }

    // RT-04: Speculation incomplete — start FRESH inference.
    // We'll dedup live tokens against the cached buffer.
  }

  // ═══ PHASE 2: Fresh full inference (dedup against buffer) ═══
  const cachedText = claimed ? claimed.buffer.join('') : '';
  let liveAccumulator = ''; // tracks live text for dedup
  let passedSeam = !claimed || claimed.tokenCount === 0; // true if no dedup needed
  let liveTokens = 0;

  try {
    const response = await axios.post(`${OLLAMA}/api/chat`, {
      model: model.name,
      messages: chatMessages,
      stream: true,
      options: {
        num_ctx: model.ctx || 16384,
        ...(ollamaOptions || {})
      }
    }, {
      responseType: 'stream',
      timeout: 120000
    });

    let lineBuffer = '';

    response.data.on('data', (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);

          if (data.message?.content) {
            const token = data.message.content;
            liveTokens++;

            if (!passedSeam) {
              // RT-04: Dedup phase — skip tokens that match cached buffer
              liveAccumulator += token;

              if (cachedText.startsWith(liveAccumulator)) {
                // Still matching cached content — suppress (already flushed)
                continue;
              }

              // Divergence detected — find the seam point
              // Send any new content from this token onward
              passedSeam = true;

              // The current token caused divergence. Check if partial overlap:
              // cachedText might be "Hello world" and liveAccumulator might be "Hello world, "
              // In that case, only send the ", " part
              if (liveAccumulator.length > cachedText.length) {
                const newContent = liveAccumulator.slice(cachedText.length);
                if (newContent.length > 0) {
                  res.write(`data: ${JSON.stringify({ type: 'token', content: newContent })}\n\n`);
                  totalTokens++;
                }
                continue;
              }

              // If live is shorter but diverged, the model went a different direction.
              // Send this token as-is — small seam artifact is acceptable.
              res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
              totalTokens++;
              continue;
            }

            // Normal streaming (past seam or no preempt)
            res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
            totalTokens++;
          }

          if (data.done) {
            res.write(`data: ${JSON.stringify({
              type: 'done',
              tokens: totalTokens,
              preemptedTokens: claimed?.tokenCount || 0,
              liveTokens,
              seamless: passedSeam
            })}\n\n`);
          }
        } catch (e) { /* skip malformed */ }
      }
    });

    response.data.on('end', () => res.end());

    response.data.on('error', (err) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.end();
      }
    });

    req.on('close', () => {
      try { response.data.destroy(); } catch (e) {}
    });

  } catch (err) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  }
}

module.exports = { streamWithPreempt };
