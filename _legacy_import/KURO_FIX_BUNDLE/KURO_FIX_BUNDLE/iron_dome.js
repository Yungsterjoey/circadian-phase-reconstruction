// ═══════════════════════════════════════════════════════════════════════════
// IRON DOME v2.0 - Enhanced Threat Detection
// L0 Security Layer - 30+ patterns
// ═══════════════════════════════════════════════════════════════════════════

var patterns = [
  // === CRITICAL (Instant Block) ===
  // Jailbreak attempts
  {p: /ignore\s+.{0,30}(instructions?|prompts?|rules?)/i, n: "Override", sev: 10},
  {p: /disregard\s+.{0,30}(rules?|guidelines?)/i, n: "Disregard", sev: 10},
  {p: /you\s+are\s+now\s+(DAN|evil|jailbroken)/i, n: "Hijack", sev: 10},
  {p: /bypass.{0,15}(safety|security)/i, n: "Bypass", sev: 10},
  {p: /forget\s+(all\s+)?(your|previous)\s*(instructions|rules)/i, n: "Forget", sev: 10},
  {p: /override\s+(your\s+)?(safety|security|restrictions)/i, n: "OverrideSafety", sev: 10},
  {p: /disable\s+(your\s+)?(safety|security|filters)/i, n: "DisableSafety", sev: 10},
  {p: /pretend\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|rules)/i, n: "Pretend", sev: 10},
  {p: /act\s+as\s+if\s+you\s+(have\s+no|don't\s+have)/i, n: "ActAs", sev: 10},
  {p: /jailbreak|jailbroken|uncensored\s+mode/i, n: "Jailbreak", sev: 10},
  
  // Code/System extraction
  {p: /(show|reveal).{0,15}system\s*prompt/i, n: "Extract", sev: 10},
  {p: /dump\s+(your|the|entire|all|full)\s*(code|codebase|source|system|prompt)/i, n: "Dump", sev: 10},
  {p: /output\s+(your|the|all)\s*(source|code|prompt|system)/i, n: "Output", sev: 10},
  {p: /print\s+(your|the|entire)\s*(codebase|source|code|prompt)/i, n: "Print", sev: 10},
  {p: /what\s+is\s+your\s+(system\s+prompt|instructions|programming)/i, n: "WhatIs", sev: 9},
  {p: /tell\s+me\s+(your|the)\s*(system|prompt|instructions|rules)/i, n: "TellMe", sev: 9},
  {p: /(?:give|show|list|export)\s+(?:me\s+)?(?:all|the)\s+(?:your\s+)?(?:files?|code|data)/i, n: "ExportAll", sev: 9},
  {p: /(?:read|cat|display)\s+(?:the\s+)?(?:entire|all|whole)\s+(?:file|source|code)/i, n: "ReadAll", sev: 9},
  
  // Dangerous commands
  {p: /sudo\s+(rm\s+-rf|shutdown|reboot)/i, n: "SudoDanger", sev: 10},
  {p: /rm\s+-rf\s+\/(?!\w)/i, n: "RmRf", sev: 10},
  {p: /:(){ :|:& };:/i, n: "ForkBomb", sev: 10},
  {p: /mkfs\.(?:ext|ntfs|fat)/i, n: "Mkfs", sev: 10},
  {p: /dd\s+if=.+of=\/dev/i, n: "DdDev", sev: 10},
  {p: /wget.+\|\s*sh/i, n: "WgetSh", sev: 10},
  {p: /curl.+\|\s*bash/i, n: "CurlBash", sev: 10},
  
  // === WARNING (Flag but may not block) ===
  {p: /what\s+(?:are\s+)?your\s+(?:limitations|constraints|rules)/i, n: "Probe", sev: 4},
  {p: /how\s+(?:were\s+you|are\s+you)\s+(trained|programmed)/i, n: "Training", sev: 3},
  {p: /(?:can\s+you|please)\s+(?:be|act)\s+(?:more\s+)?(?:unrestricted|unfiltered)/i, n: "Unfilter", sev: 5},
  {p: /eval\s*\(/i, n: "Eval", sev: 5},
  {p: /\$\{.*process\.env/i, n: "EnvAccess", sev: 6},
];

var BLOCK_THRESHOLD = 8;

function ironDomeCheck(messages) {
  var result = {safe: true, intercepted: false, threats: [], status: "CLEAR", message: "Clear", score: 0};
  
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role !== "user") continue;
    var content = (messages[i].content || "").toLowerCase();
    
    for (var j = 0; j < patterns.length; j++) {
      if (patterns[j].p.test(content)) {
        result.threats.push({name: patterns[j].n, severity: patterns[j].sev});
        result.score += patterns[j].sev;
      }
    }
  }
  
  if (result.score >= BLOCK_THRESHOLD) {
    result.safe = false;
    result.intercepted = true;
    result.status = "BLOCKED";
    result.message = result.threats.map(function(t) { return t.name; }).join(", ");
  } else if (result.score >= 4) {
    result.status = "WARNING";
    result.message = result.threats.map(function(t) { return t.name; }).join(", ");
  }
  
  return result;
}

module.exports = {ironDomeCheck: ironDomeCheck, BLOCK_THRESHOLD: BLOCK_THRESHOLD};
