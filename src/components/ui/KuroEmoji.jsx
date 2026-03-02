/**
 * KuroEmoji — Animated line-drawing emoji engine
 *
 * Replaces stock emoji with Fluent High Contrast SVGs that "draw" themselves
 * on first appearance using stroke-dashoffset animation, then fade to fill.
 *
 * Usage:
 *   <KuroEmoji char="😀" size={20} />
 *   — or —
 *   renderKuroText("Hello 🔥🚀")  → mixed text + KuroEmoji nodes
 */
import { memo, useRef, useEffect, useState } from 'react';
import KURO_EMOJI from '../../data/kuroEmoji';

/* ── Regex to match emoji in text ─────────────────────────── */
const EMOJI_RE = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu;

/* ── Single animated emoji ────────────────────────────────── */
const KuroEmoji = memo(({ char, size = 20, animate = true }) => {
  const paths = KURO_EMOJI.get(char);
  if (!paths) return <span className="ke-fallback">{char}</span>;

  const svgRef = useRef(null);
  const [drawn, setDrawn] = useState(!animate);

  useEffect(() => {
    if (!animate || drawn) return;
    const svg = svgRef.current;
    if (!svg) return;

    const allPaths = svg.querySelectorAll('path');
    let totalDur = 0;

    allPaths.forEach((p, i) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;

      // Stagger each path: distribute across 2.2s total draw time
      const delay = (i / allPaths.length) * 0.6;
      const dur = 1.6 + (len > 100 ? 0.4 : 0); // longer paths get more time
      p.style.transition = `stroke-dashoffset ${dur}s cubic-bezier(0.4, 0, 0.2, 1) ${delay}s, fill 0.5s ease ${delay + dur - 0.3}s, opacity 0.3s ease ${delay}s`;
      p.style.opacity = '1';
      totalDur = Math.max(totalDur, delay + dur);
    });

    // Trigger the draw on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        allPaths.forEach(p => {
          p.style.strokeDashoffset = '0';
        });
        // After draw completes, fade in fill
        setTimeout(() => setDrawn(true), totalDur * 1000);
      });
    });
  }, [animate, drawn]);

  return (
    <svg
      ref={svgRef}
      className={`ke ${drawn ? 'ke-filled' : 'ke-drawing'}`}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-label={char}
      role="img"
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          style={!animate || drawn ? undefined : { strokeDashoffset: '999', opacity: 0 }}
        />
      ))}
    </svg>
  );
});
KuroEmoji.displayName = 'KuroEmoji';

/* ── Text parser: replaces emoji in a string with KuroEmoji nodes ── */
export function renderKuroText(text, emojiSize = 18, animate = true) {
  if (!text) return text;
  const parts = [];
  let last = 0;
  let match;

  // Reset regex
  EMOJI_RE.lastIndex = 0;

  while ((match = EMOJI_RE.exec(text)) !== null) {
    // Push preceding text
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const ch = match[0].replace(/\uFE0F$/, ''); // strip variation selector
    if (KURO_EMOJI.has(ch)) {
      parts.push(<KuroEmoji key={`e${match.index}`} char={ch} size={emojiSize} animate={animate} />);
    } else {
      // Not in our set — render original emoji
      parts.push(match[0]);
    }
    last = match.index + match[0].length;
  }

  // Trailing text
  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

/* ── Check if a message is emoji-only (for large display) ── */
export function isEmojiOnly(text) {
  if (!text) return false;
  const stripped = text.replace(EMOJI_RE, '').replace(/[\s\uFE0F]/g, '');
  return stripped.length === 0 && text.length <= 12;
}

export default KuroEmoji;
