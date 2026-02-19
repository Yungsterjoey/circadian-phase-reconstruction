/**
 * KURO::VISION — Intent Detector
 * 
 * Classifies user prompt into pipeline paths:
 *   simple    → Direct FLUX generation, skip feedback loop if high confidence
 *   spatial   → Force scene graph + ControlNet conditioning
 *   text      → Force compositor path (two-pass: background + text overlay)
 *   edit      → Modify existing image using session memory
 * 
 * v6.3 compliance: No IO, pure computation.
 */

// ─── Pattern Banks ───────────────────────────────────────────────────────

const TEXT_PATTERNS = [
  /\b(?:poster|menu|sign|banner|card|logo|infographic|flyer|invitation)\b/i,
  /\b(?:typography|typeface|font|lettering|headline|tagline)\b/i,
  /\b(?:ui|interface|dashboard|mockup|wireframe|layout)\b/i,
  /\b(?:text|words?|says?|reads?|written|label|title|caption|subtitle)\b/i,
  /["'`].{2,}["'`]/,  // Quoted text = text rendering intent
  /\bthat\s+(?:says|reads)\b/i,
];

const SPATIAL_PATTERNS = [
  /\b(?:left|right|top|bottom|center|middle|foreground|background)\b/i,
  /\b(?:next\s+to|behind|in\s+front|above|below|between|beside)\b/i,
  /\b(?:arrange|layout|composition|scene|multiple\s+(?:objects?|items?|people))\b/i,
  /\b(?:grid|row|column|stack|overlap|layer)\b/i,
  /\b\d+\s+(?:objects?|items?|people|characters?|elements?)\b/i,
];

const EDIT_PATTERNS = [
  /\b(?:change|move|adjust|modify|edit|update|replace|swap|shift)\b/i,
  /\b(?:make\s+(?:it|the|this)|increase|decrease|bigger|smaller)\b/i,
  /\b(?:more|less|add|remove|delete)\s+\w+/i,
  /\b(?:same\s+(?:image|picture)|keep|maintain)\b/i,
];

// ─── Classifier ──────────────────────────────────────────────────────────

function classifyIntent(prompt, sessionHasImage = false) {
  const p = prompt.trim();
  
  const textScore = TEXT_PATTERNS.reduce((s, pat) => s + (pat.test(p) ? 1 : 0), 0);
  const spatialScore = SPATIAL_PATTERNS.reduce((s, pat) => s + (pat.test(p) ? 1 : 0), 0);
  const editScore = EDIT_PATTERNS.reduce((s, pat) => s + (pat.test(p) ? 1 : 0), 0);
  
  // Extract quoted text segments for compositor
  const quotedText = [];
  const quoteRegex = /["'`]([^"'`]{2,})["'`]/g;
  let match;
  while ((match = quoteRegex.exec(p)) !== null) {
    quotedText.push(match[1]);
  }
  
  // "that says X" / "reading X"
  const saysRegex = /(?:says?|reads?|reading|written)\s+["'`]?([^"'`.,]+)["'`]?/gi;
  while ((match = saysRegex.exec(p)) !== null) {
    if (!quotedText.includes(match[1])) quotedText.push(match[1]);
  }
  
  // Determine pipeline
  let pipeline = 'simple';
  let confidence = 0.7;
  let reason = 'Default: straightforward generation';
  
  if (sessionHasImage && editScore >= 2) {
    pipeline = 'edit';
    confidence = 0.6 + (editScore * 0.1);
    reason = `Edit intent detected (${editScore} edit signals)`;
  } else if (textScore >= 2 || quotedText.length > 0) {
    pipeline = 'text';
    confidence = 0.7 + (textScore * 0.08);
    reason = `Text rendering required (${textScore} text signals, ${quotedText.length} text segments)`;
  } else if (spatialScore >= 2) {
    pipeline = 'spatial';
    confidence = 0.6 + (spatialScore * 0.1);
    reason = `Spatial complexity detected (${spatialScore} spatial signals)`;
  } else {
    // Simple — high confidence if short, descriptive prompt
    const wordCount = p.split(/\s+/).length;
    if (wordCount <= 15) confidence = 0.85;
    else if (wordCount <= 30) confidence = 0.7;
    else confidence = 0.55;
    reason = `Simple generation (${wordCount} words, confidence ${confidence.toFixed(2)})`;
  }
  
  return {
    pipeline,
    confidence: Math.min(confidence, 0.95),
    reason,
    textSegments: quotedText,
    scores: { text: textScore, spatial: spatialScore, edit: editScore },
    skipFeedbackLoop: pipeline === 'simple' && confidence >= 0.8
  };
}

module.exports = { classifyIntent, TEXT_PATTERNS, SPATIAL_PATTERNS, EDIT_PATTERNS };
