/**
 * KURO::SELF-HEAL v1.0 — Autonomous Remediation Engine
 * 
 * Commercial AI reports errors. KURO fixes them.
 * 
 * Wraps table_rocket sandbox simulation. When simulation FAILS:
 *   1. Analyze failure type (missing deps, syntax, build, security)
 *   2. Attempt autonomous remediation per failure type
 *   3. Re-simulate with fixes applied
 *   4. If still failing after MAX_HEAL_ATTEMPTS, report with diagnostics
 * 
 * Remediation strategies:
 *   - Missing deps → generate npm install commands
 *   - Syntax errors → ask kuro-forge to fix the specific error
 *   - Build errors → analyze error message, patch affected file
 *   - Security flags → strip dangerous patterns, add safe alternatives
 * 
 * Tier gate: Pro+ only (free tier gets standard fail/report)
 * 
 * v7.0.2b — Extracted from Gemini "Self-Healing Hybrid" proposal
 */

const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MAX_HEAL_ATTEMPTS = 2;

// ═══════════════════════════════════════════════════════════════════════════
// REMEDIATION STRATEGIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze a table_rocket simulation result and produce fix actions.
 */
function diagnose(simResult) {
  const fixes = [];

  // Missing dependencies → npm install commands
  if (simResult.missingDeps?.length > 0) {
    const packages = [...new Set(simResult.missingDeps.map(d => d.package))];
    fixes.push({
      type: 'missing_deps',
      severity: 'auto_fixable',
      action: 'install',
      packages,
      command: `npm install ${packages.join(' ')}`,
      description: `Missing ${packages.length} package(s): ${packages.join(', ')}`
    });
  }

  // Syntax errors → ask LLM to fix
  if (simResult.syntaxErrors?.length > 0) {
    for (const err of simResult.syntaxErrors) {
      fixes.push({
        type: 'syntax_error',
        severity: 'llm_fixable',
        action: 'patch',
        file: err.file,
        error: err.error,
        line: err.line,
        description: `Syntax error in ${err.file} at line ${err.line}: ${err.error}`
      });
    }
  }

  // Build errors → analyze and patch
  if (simResult.buildErrors?.length > 0) {
    for (const err of simResult.buildErrors) {
      fixes.push({
        type: 'build_error',
        severity: 'llm_fixable',
        action: 'patch',
        error: err.error || JSON.stringify(err),
        description: `Build error: ${err.error || 'unknown'}`
      });
    }
  }

  // Security flags → strip dangerous patterns
  if (simResult.securityFlags?.length > 0) {
    const highSeverity = simResult.securityFlags.filter(f => f.severity === 'high');
    if (highSeverity.length > 0) {
      fixes.push({
        type: 'security',
        severity: 'must_fix',
        action: 'strip',
        flags: highSeverity,
        description: `${highSeverity.length} high-severity security flag(s)`
      });
    }
  }

  return {
    canAutoHeal: fixes.some(f => f.severity === 'auto_fixable' || f.severity === 'llm_fixable'),
    fixes,
    totalIssues: fixes.length
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM-ASSISTED PATCHING
// ═══════════════════════════════════════════════════════════════════════════

const HEALER_PROMPT = `You are KURO::HEALER, the autonomous remediation system.

You are given code that FAILED simulation with specific errors.
Your job is to FIX the errors and return the corrected code.

RULES:
1. Fix ONLY the reported errors — do not refactor unrelated code
2. Preserve the original intent and style
3. If a missing import is the issue, add it
4. If a syntax error, fix the syntax
5. If a type error, fix the types
6. Return the COMPLETE fixed file content

OUTPUT FORMAT:
<file path="[original path]" action="modify">
[complete fixed file content]
</file>`;

async function llmPatch(fileContent, filePath, errors, healModel) {
  const prompt = `Fix the following errors in ${filePath}:

ERRORS:
${errors.map(e => `- ${e.description || e.error || e}`).join('\n')}

CURRENT FILE CONTENT:
\`\`\`
${fileContent.slice(0, 8000)}
\`\`\`

Return the complete fixed file using <file> tags.`;

  try {
    const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
      model: healModel,
      messages: [
        { role: 'system', content: HEALER_PROMPT },
        { role: 'user', content: prompt }
      ],
      stream: false,
      options: { temperature: 0.1, num_ctx: 16384 }
    }, { timeout: 120000 });

    const response = data.message?.content || '';
    
    // Parse file content from response
    const fileMatch = response.match(/<file[^>]*>([\s\S]*?)<\/file>/);
    if (fileMatch) {
      return { success: true, content: fileMatch[1].trim(), raw: response };
    }

    return { success: false, reason: 'No <file> tag in healer response', raw: response };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HEAL LOOP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Attempt to heal a failed simulation result.
 * 
 * @param {object} simResult — table_rocket simulation result (status: FAIL)
 * @param {Array} fileChanges — original file changes that failed
 * @param {object} options — { healModel, sandbox, onPhase }
 * @returns {object} { healed, fileChanges, commands, attempts, diagnosis }
 */
async function heal(simResult, fileChanges, options = {}) {
  const {
    healModel = 'kuro-scout',
    sandbox = null,   // table_rocket instance for re-simulation
    onPhase = null,   // SSE callback: (phase, status, data) => void
    maxAttempts = MAX_HEAL_ATTEMPTS
  } = options;

  const emit = (phase, status, data) => onPhase?.(phase, status, data);
  let currentChanges = [...fileChanges];
  let currentResult = simResult;
  let extraCommands = [];
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    emit('heal_diagnose', 'active', { attempt: attempts });

    const diagnosis = diagnose(currentResult);
    emit('heal_diagnose', 'complete', { 
      canAutoHeal: diagnosis.canAutoHeal, 
      issues: diagnosis.totalIssues,
      fixes: diagnosis.fixes.map(f => f.type)
    });

    if (!diagnosis.canAutoHeal) {
      return {
        healed: false,
        reason: 'no_auto_fixable_issues',
        fileChanges: currentChanges,
        attempts,
        diagnosis
      };
    }

    // Apply fixes
    emit('heal_remediate', 'active', { attempt: attempts, fixes: diagnosis.fixes.length });

    for (const fix of diagnosis.fixes) {
      switch (fix.type) {
        case 'missing_deps':
          // Add install command
          extraCommands.push(fix.command);
          emit('heal_action', 'install', { packages: fix.packages });
          break;

        case 'syntax_error':
        case 'build_error': {
          // Find the affected file in changes
          const affectedFile = fix.file 
            ? currentChanges.find(c => c.path === fix.file)
            : currentChanges[0]; // Build errors may not specify a file

          if (affectedFile) {
            const errors = diagnosis.fixes.filter(f => 
              f.file === affectedFile.path || f.type === 'build_error'
            );
            
            emit('heal_action', 'patch', { file: affectedFile.path, model: healModel });
            const patch = await llmPatch(affectedFile.content, affectedFile.path, errors, healModel);
            
            if (patch.success) {
              affectedFile.content = patch.content;
              emit('heal_action', 'patched', { file: affectedFile.path, success: true });
            } else {
              emit('heal_action', 'patch_failed', { file: affectedFile.path, reason: patch.reason });
            }
          }
          break;
        }

        case 'security': {
          // Strip dangerous patterns from affected files
          for (const flag of fix.flags) {
            const affected = currentChanges.find(c => c.path === flag.file);
            if (affected) {
              // Simple pattern removal for high-severity issues
              if (flag.pattern) {
                affected.content = affected.content.replace(new RegExp(flag.pattern, 'g'), '/* KURO::HEALER: removed unsafe pattern */');
              }
              emit('heal_action', 'strip', { file: flag.file, pattern: flag.name });
            }
          }
          break;
        }
      }
    }

    emit('heal_remediate', 'complete', { attempt: attempts });

    // Re-simulate if sandbox available
    if (sandbox) {
      emit('heal_resim', 'active', { attempt: attempts });
      currentResult = await sandbox.simulate(currentChanges, extraCommands);
      emit('heal_resim', 'complete', { result: currentResult.result });

      if (currentResult.result === 'PASS') {
        return {
          healed: true,
          fileChanges: currentChanges,
          commands: extraCommands,
          attempts,
          diagnosis,
          simResult: currentResult
        };
      }
    } else {
      // No sandbox for re-sim — return patched changes optimistically
      return {
        healed: true,
        optimistic: true,
        fileChanges: currentChanges,
        commands: extraCommands,
        attempts,
        diagnosis
      };
    }
  }

  // Exhausted attempts
  return {
    healed: false,
    reason: 'max_attempts_exhausted',
    fileChanges: currentChanges,
    commands: extraCommands,
    attempts,
    lastResult: currentResult
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  heal,
  diagnose,
  llmPatch,
  MAX_HEAL_ATTEMPTS,
  HEALER_PROMPT
};
