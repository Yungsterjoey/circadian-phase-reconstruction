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

function createThinkStreamEmitter(send) {
  let buffer = '';
  let lastLabel = '';
  function pushText(chunk) {
    if (!chunk) return;
    buffer += String(chunk);

    while (true) {
      const start = buffer.search(/<(think|plan)>/i);
      if (start === -1) break;
      const endTag = buffer.search(/<\/(think|plan)>\s*/i);
      if (endTag === -1) break;

      const tagStartMatch = buffer.slice(start).match(/<(think|plan)>/i);
      if (!tagStartMatch) break;

      const tag = tagStartMatch[1].toLowerCase();
      const openIdx = buffer.toLowerCase().indexOf(`<${tag}>`, start);
      const closeIdx = buffer.toLowerCase().indexOf(`</${tag}>`, openIdx);
      if (openIdx == -1 || closeIdx == -1) break;

      const inner = buffer.slice(openIdx + (`<${tag}>`).length, closeIdx);
      const label = mapThinkToLabel(inner);

      if (label && label !== lastLabel) {
        lastLabel = label;
        send(label);
      }

      buffer = buffer.slice(closeIdx + (`</${tag}>`).length);
    }

    if (buffer.length > 8192) buffer = buffer.slice(-2048);
  }

  function reset() { buffer=''; lastLabel=''; }
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
