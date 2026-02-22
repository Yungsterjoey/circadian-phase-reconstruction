/**
 * KURO::PREEMPT — Stream Integration Patch
 * 
 * Insert this logic at the TOP of your /api/stream handler,
 * AFTER layer processing but BEFORE the Ollama POST.
 * 
 * This claims any buffered speculation and flushes it at wire speed,
 * then either ends (if complete) or continues with fresh live inference.
 */

// ─── Add this require at top of server.cjs ───
// const preemptEngine = require('./layers/preempt_engine.cjs');

// ─── Insert this block inside /api/stream, after layers, before Ollama call ───

/*
    // ═══ PREEMPT CLAIM ═══
    // Check if we have pre-computed tokens for this request
    const claimed = preemptEngine.claim(sessionId, userMessage);
    
    if (claimed && claimed.tokenCount > 0) {
      // Send preempt metadata (frontend uses this for fluid transition)
      res.write(`data: ${JSON.stringify({ 
        type: 'preempt_start', 
        buffered: claimed.tokenCount,
        speculatedInput: claimed.speculatedInput,
        elapsed: Date.now() - claimed.startTime
      })}\n\n`);
      
      // Flush buffered tokens at wire speed (~2ms gaps for smooth rendering)
      for (let i = 0; i < claimed.buffer.length; i++) {
        res.write(`data: ${JSON.stringify({ 
          type: 'token', 
          content: claimed.buffer[i],
          preempted: true 
        })}\n\n`);
        
        // Micro-delay for smooth client-side rendering (not perceptible as delay)
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 2));
      }
      
      res.write(`data: ${JSON.stringify({ 
        type: 'preempt_end', 
        flushed: claimed.tokenCount 
      })}\n\n`);
      
      // If speculation completed the full response, we're done
      if (claimed.status === 'done') {
        res.write(`data: ${JSON.stringify({ type: 'done', preempted: true })}\n\n`);
        res.end();
        return;
      }
      
      // Otherwise: speculation was capped or still streaming.
      // Continue with fresh Ollama call, but INJECT the already-generated
      // text as assistant context so the model continues from where speculation left off.
      const preemptedText = claimed.buffer.join('');
      
      // Append partial assistant response to messages so model continues naturally
      chatMessages.push({ role: 'assistant', content: preemptedText });
      chatMessages.push({ role: 'user', content: 'Continue your response from where you left off. Do not repeat what you already said.' });
      
      // Fall through to normal Ollama streaming below...
    }
    // ═══ END PREEMPT CLAIM ═══
*/


// ─── COMPLETE EXAMPLE: Minimal /api/stream with preempt ───

async function handleStreamWithPreempt(req, res, config) {
  const { messages, mode, sessionId } = req.body;
  const userMessage = messages?.[messages.length - 1]?.content || '';

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Run your layer pipeline here (Iron Dome, Semantic Router, etc.)
  // ...layers...

  // Build chat messages for Ollama
  let chatMessages = [...(messages || [])];
  let preemptedTokens = 0;

  // ═══ PREEMPT: Claim buffered speculation ═══
  const preemptEngine = require('./layers/preempt_engine.cjs');
  const claimed = preemptEngine.claim(sessionId, userMessage);

  if (claimed && claimed.tokenCount > 0) {
    res.write(`data: ${JSON.stringify({ type: 'preempt_start', buffered: claimed.tokenCount })}\n\n`);

    for (let i = 0; i < claimed.buffer.length; i++) {
      res.write(`data: ${JSON.stringify({ type: 'token', content: claimed.buffer[i], preempted: true })}\n\n`);
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 2));
    }

    res.write(`data: ${JSON.stringify({ type: 'preempt_end', flushed: claimed.tokenCount })}\n\n`);
    preemptedTokens = claimed.tokenCount;

    if (claimed.status === 'done') {
      res.write(`data: ${JSON.stringify({ type: 'done', preempted: true, tokens: preemptedTokens })}\n\n`);
      res.end();
      return;
    }

    // Continuation: inject preempted text so model picks up where it left off
    const partial = claimed.buffer.join('');
    chatMessages.push({ role: 'assistant', content: partial });
    chatMessages.push({ role: 'user', content: 'Continue from where you left off without repeating.' });
  }

  // ═══ Normal Ollama streaming (fresh or continuation) ═══
  const model = config.MODELS[mode === 'dev' ? 'dev' : 'main'];

  try {
    const axios = require('axios');
    const response = await axios.post(`${config.OLLAMA_URL}/api/chat`, {
      model: model.name,
      messages: chatMessages,
      stream: true,
      options: { num_ctx: model.ctx }
    }, { responseType: 'stream', timeout: 120000 });

    let liveTokens = 0;
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
            liveTokens++;
            res.write(`data: ${JSON.stringify({ type: 'token', content: data.message.content })}\n\n`);
          }
          if (data.done) {
            res.write(`data: ${JSON.stringify({ type: 'done', tokens: preemptedTokens + liveTokens, preemptedTokens })}\n\n`);
          }
        } catch (e) {}
      }
    });

    response.data.on('end', () => res.end());
    response.data.on('error', () => res.end());
    req.on('close', () => { try { response.data.destroy(); } catch(e) {} });

  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
}

module.exports = { handleStreamWithPreempt };
