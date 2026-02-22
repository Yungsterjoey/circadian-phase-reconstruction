function stripThinkBlocks(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
  out = out.replace(/<plan>[\s\S]*?<\/plan>\s*/gi, '');
  out = out.replace(/<\/?(think|plan)>\s*/gi, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function mapThinkToLabel(raw) {
  const t = String(raw || '').toLowerCase();
  const rules = [
    { re: /(sudo|whoami|id -u|root|bash|shell|chmod|chown)/, label: 'Writing sudo/bash logic…' },
    { re: /(router|route|semantic|classify|intent)/, label: 'Routing request…' },
    { re: /(memory|recall|history|context|session)/, label: 'Recalling context…' },
    { re: /(plan|approach|steps|strategy)/, label: 'Planning steps…' },
    { re: /(debug|bug|error|trace|stack|fix)/, label: 'Debugging…' },
    { re: /(react|jsx|component|state|hook|zustand|ui)/, label: 'Updating KURO UI…' },
    { re: /(server|express|endpoint|api|sse|stream)/, label: 'Wiring stream controller…' },
    { re: /(deploy|pm2|nginx|systemd|service|restart)/, label: 'Preparing deployment…' },
    { re: /(test|quick test|verify|check)/, label: 'Verifying…' },
  ];
  for (const r of rules) if (r.re.test(t)) return r.label;
  return 'Thinking…';
}

/**
 * Per-sentence streaming emitter for <think>/<plan> blocks.
 * Calls send({ type: 'thinking', content: sentence }) for each complete
 * sentence extracted from the thinking block as tokens arrive.
 */
function createThinkStreamEmitter(send) {
  let buf = '';        // raw token buffer (for tag detection)
  let inThink = false; // currently inside a <think>/<plan> block
  let thinkBuf = '';   // accumulated think text, pending sentence split

  function pushText(chunk) {
    if (!chunk) return;
    buf += String(chunk);

    let progress = true;
    while (progress && buf.length) {
      progress = false;

      if (inThink) {
        const lo = buf.toLowerCase();
        let closeAt = -1;
        const c1 = lo.indexOf('</think>');
        const c2 = lo.indexOf('</plan>');
        if (c1 !== -1 && c2 !== -1) closeAt = Math.min(c1, c2);
        else if (c1 !== -1) closeAt = c1;
        else if (c2 !== -1) closeAt = c2;

        if (closeAt === -1) {
          // Keep last 8 chars in case the closing tag spans chunks
          const safe = buf.length > 8 ? buf.length - 8 : 0;
          thinkBuf += buf.slice(0, safe);
          buf = buf.slice(safe);
          _emitSentences(false);
          return;
        }
        thinkBuf += buf.slice(0, closeAt);
        const tagEnd = buf.indexOf('>', closeAt) + 1;
        buf = buf.slice(tagEnd > 0 ? tagEnd : closeAt + 8);
        inThink = false;
        _emitSentences(true);
        thinkBuf = '';
        progress = true;

      } else {
        const lo = buf.toLowerCase();
        let openAt = -1;
        const o1 = lo.indexOf('<think>');
        const o2 = lo.indexOf('<plan>');
        if (o1 !== -1 && o2 !== -1) openAt = Math.min(o1, o2);
        else if (o1 !== -1) openAt = o1;
        else if (o2 !== -1) openAt = o2;

        if (openAt === -1) {
          if (buf.length > 64) buf = buf.slice(-16);
          return;
        }
        const tagEnd = buf.indexOf('>', openAt) + 1;
        if (tagEnd === 0) return; // partial tag — wait for more
        buf = buf.slice(tagEnd);
        inThink = true;
        thinkBuf = '';
        progress = true;
      }
    }
  }

  function _emitSentences(flush) {
    // Emit any sentence that ends with . ! ? or newline
    while (thinkBuf.length) {
      const m = thinkBuf.match(/^([\s\S]*?[.!?\n])\s*/);
      if (!m) break;
      // When not flushing, keep a 20-char guard to avoid splitting across chunk boundaries
      if (!flush && thinkBuf.length - m[0].length < 20) break;
      const sentence = m[1].replace(/\s+/g, ' ').trim();
      if (sentence.length > 5 && send) {
        send({ type: 'thinking', content: sentence.slice(0, 200) });
      }
      thinkBuf = thinkBuf.slice(m[0].length);
    }
    if (flush && thinkBuf.replace(/\s+/g, '').length > 5 && send) {
      send({ type: 'thinking', content: thinkBuf.replace(/\s+/g, ' ').trim().slice(0, 200) });
      thinkBuf = '';
    }
  }

  function reset() { buf = ''; inThink = false; thinkBuf = ''; }
  return { pushText, reset };
}

/**
 * Stateful filter that REMOVES think/plan content from the user-visible token stream
 * (even if tags split across chunks).
 */
function createThinkContentFilter() {
  let buf = '';
  let inThink = false;

  function push(chunk) {
    if (!chunk) return '';
    buf += String(chunk);
    let out = '';

    const keepTail = (s, n) => (s.length > n ? s.slice(-n) : s);

    while (buf.length) {
      if (inThink) {
        const close = buf.search(/<\/(think|plan)>\s*/i);
        if (close === -1) { buf = keepTail(buf, 64); return out; }
        const m = buf.slice(close).match(/<\/(think|plan)>\s*/i);
        buf = buf.slice(close + (m ? m[0].length : 0));
        inThink = false;
        continue;
      } else {
        const open = buf.search(/<(think|plan)>\s*/i);
        if (open === -1) {
          if (buf.length <= 64) return out;
          out += buf.slice(0, -64);
          buf = buf.slice(-64);
          return stripThinkBlocks(out);
        }
        if (open > 0) out += buf.slice(0, open);
        const m = buf.slice(open).match(/<(think|plan)>\s*/i);
        buf = buf.slice(open + (m ? m[0].length : 0));
        inThink = true;
        continue;
      }
    }
    return stripThinkBlocks(out);
  }

  function reset(){ buf=''; inThink=false; }
  return { push, reset };
}

module.exports = {
  stripThinkBlocks,
  mapThinkToLabel,
  createThinkStreamEmitter,
  createThinkContentFilter,
};
