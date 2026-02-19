// ═══════════════════════════════════════════════════════════════════════════
// VOTER LAYER - Actor-Judge Code Verification System
// Actor generates code, Judge evaluates it for correctness and security
// ═══════════════════════════════════════════════════════════════════════════

const JUDGE_SYSTEM_PROMPT = `You are KURO::JUDGE, the flight computer verification system.

Your role is to evaluate code produced by ACTOR for:
1. CORRECTNESS: Does the code achieve the user's stated goal?
2. SECURITY: Are there any injection vulnerabilities, unsafe operations, or data leaks?
3. COHERENCE: Does the code fit the existing codebase style and patterns?
4. COMPLETENESS: Is the implementation complete or are there TODO items?

EVALUATION CRITERIA:
- Code must not introduce breaking changes unless explicitly requested
- All imports must be valid and packages must exist
- No hardcoded secrets or credentials
- No eval(), new Function(), or dynamic code execution
- Proper error handling for async operations
- React components should handle loading and error states

OUTPUT FORMAT (respond with ONLY this JSON, no other text):
{
  "confidence": 0.0-1.0,
  "recommendation": "PASS" | "FAIL",
  "issues": [
    { "severity": "high|medium|low", "description": "..." }
  ],
  "suggestions": ["..."]
}`;

const ACTOR_SYSTEM_PROMPT = `You are KURO::ACTOR, the autonomous code generation system.

Your outputs will be verified by KURO::JUDGE before being committed.

RULES:
1. Generate complete, working code - no placeholders or "implement here" comments
2. Follow the existing codebase style and patterns
3. Include all necessary imports
4. Handle edge cases and errors appropriately
5. For React components, include proper PropTypes or TypeScript types if the codebase uses them

OUTPUT FORMAT for file changes:
<file path="src/path/to/file.jsx" action="create|modify">
[complete file content here]
</file>

For terminal commands:
<terminal>$ npm install package-name</terminal>

Always explain your changes briefly after the code blocks.`;

class VoterLayer {
  constructor(ollamaUrl = 'http://localhost:11434') {
    this.ollamaUrl = ollamaUrl;
    this.actorModel = 'kuro-forge';
    this.judgeModel = 'kuro-logic';
    this.confidenceThreshold = 0.85;
    this.maxRetries = 1; // Default — overridden by setRetryLimit()
  }

  // A4: Tier-based retry limits
  // free=0, pro=1, sovereign=3
  static TIER_RETRIES = { free: 0, pro: 1, sovereign: 3 };

  setRetryLimit(tier) {
    this.maxRetries = VoterLayer.TIER_RETRIES[tier] ?? 1;
    return this;
  }

  // Set models
  setModels(actor, judge) {
    this.actorModel = actor;
    this.judgeModel = judge;
    return this;
  }

  // Set confidence threshold
  setThreshold(threshold) {
    this.confidenceThreshold = threshold;
    return this;
  }

  // Call Ollama API
  async callOllama(model, messages, options = {}) {
    const response = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature || 0.3,
          num_ctx: options.ctx || 16384
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    return data.message?.content || '';
  }

  // Actor generates code
  async actorGenerate(userPrompt, context = [], retryFeedback = null) {
    const messages = [
      { role: 'system', content: ACTOR_SYSTEM_PROMPT }
    ];

    // Add context files
    if (context.length > 0) {
      let contextMessage = 'EXISTING CODEBASE CONTEXT:\n\n';
      for (const file of context) {
        contextMessage += `--- ${file.path} ---\n${file.content}\n\n`;
      }
      messages.push({ role: 'user', content: contextMessage });
      messages.push({ role: 'assistant', content: 'I have reviewed the existing codebase context. Ready for your request.' });
    }

    // Add retry feedback if this is a retry
    if (retryFeedback) {
      messages.push({ 
        role: 'user', 
        content: `JUDGE FEEDBACK FROM PREVIOUS ATTEMPT:\n${retryFeedback}\n\nPlease address these issues and regenerate the code.` 
      });
    }

    // Add user prompt
    messages.push({ role: 'user', content: userPrompt });

    const response = await this.callOllama(this.actorModel, messages, { temperature: 0.3 });
    
    // Parse file changes from response
    const fileChanges = this.parseFileChanges(response);
    const commands = this.parseCommands(response);

    return {
      raw: response,
      fileChanges,
      commands,
      model: this.actorModel
    };
  }

  // Judge evaluates Actor output
  async judgeEvaluate(userPrompt, actorOutput, context = []) {
    const messages = [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT }
    ];

    // Build evaluation context
    let evalContext = `USER REQUEST:\n${userPrompt}\n\n`;
    evalContext += `ACTOR OUTPUT:\n${actorOutput.raw}\n\n`;
    
    if (context.length > 0) {
      evalContext += 'EXISTING FILES FOR COMPARISON:\n\n';
      for (const file of context.slice(0, 3)) { // Limit context
        evalContext += `--- ${file.path} ---\n${file.content.slice(0, 2000)}\n\n`;
      }
    }

    messages.push({ role: 'user', content: evalContext });

    const response = await this.callOllama(this.judgeModel, messages, { temperature: 0.1 });
    
    // Parse JSON response
    let result;
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (e) {
      // Default to pass if parsing fails but response looks positive
      result = {
        confidence: response.toLowerCase().includes('pass') ? 0.9 : 0.5,
        recommendation: response.toLowerCase().includes('pass') ? 'PASS' : 'FAIL',
        issues: [],
        suggestions: []
      };
    }

    return {
      ...result,
      model: this.judgeModel,
      raw: response
    };
  }

  // Full voter pipeline
  async vote(userPrompt, context = []) {
    let actorOutput = null;
    let judgeResult = null;
    let attempts = 0;
    let feedback = null;

    while (attempts <= this.maxRetries) {
      attempts++;

      // Actor generates
      actorOutput = await this.actorGenerate(userPrompt, context, feedback);

      // Judge evaluates
      judgeResult = await this.judgeEvaluate(userPrompt, actorOutput, context);

      // Check if passed
      if (judgeResult.confidence >= this.confidenceThreshold && judgeResult.recommendation === 'PASS') {
        return {
          status: 'PASS',
          actorOutput,
          judgeResult,
          attempts
        };
      }

      // Generate feedback for retry
      if (attempts <= this.maxRetries) {
        feedback = `Confidence: ${judgeResult.confidence}\nIssues:\n`;
        for (const issue of judgeResult.issues || []) {
          feedback += `- [${issue.severity}] ${issue.description}\n`;
        }
        if (judgeResult.suggestions?.length > 0) {
          feedback += `\nSuggestions:\n`;
          for (const suggestion of judgeResult.suggestions) {
            feedback += `- ${suggestion}\n`;
          }
        }
      }
    }

    // Failed after retries
    return {
      status: 'FAIL',
      actorOutput,
      judgeResult,
      attempts,
      feedback
    };
  }

  // Parse file changes from Actor output
  parseFileChanges(response) {
    const changes = [];
    const fileRegex = /<file\s+path=["']([^"']+)["']\s*(?:action=["']([^"']+)["'])?\s*>([\s\S]*?)<\/file>/g;
    let match;

    while ((match = fileRegex.exec(response)) !== null) {
      changes.push({
        path: match[1],
        action: match[2] || 'modify',
        content: match[3].trim()
      });
    }

    return changes;
  }

  // Parse commands from Actor output
  parseCommands(response) {
    const commands = [];
    const cmdRegex = /<terminal>\$?\s*(.+?)<\/terminal>/g;
    let match;

    while ((match = cmdRegex.exec(response)) !== null) {
      commands.push(match[1].trim());
    }

    return commands;
  }

  // Stream-compatible voting (for SSE)
  async *voteStream(userPrompt, context = []) {
    yield { type: 'voter', status: 'PLANNING', actor: this.actorModel };

    let actorOutput = null;
    let judgeResult = null;
    let attempts = 0;
    let feedback = null;

    while (attempts <= this.maxRetries) {
      attempts++;

      // Actor phase
      yield { type: 'voter', status: 'GENERATING', attempt: attempts };
      actorOutput = await this.actorGenerate(userPrompt, context, feedback);
      yield { type: 'voter', status: 'GENERATED', files: actorOutput.fileChanges.length };

      // Judge phase
      yield { type: 'voter', status: 'VERIFYING', judge: this.judgeModel };
      judgeResult = await this.judgeEvaluate(userPrompt, actorOutput, context);
      yield { 
        type: 'voter', 
        status: 'VERIFIED',
        confidence: judgeResult.confidence,
        recommendation: judgeResult.recommendation,
        issues: judgeResult.issues?.length || 0
      };

      if (judgeResult.confidence >= this.confidenceThreshold && judgeResult.recommendation === 'PASS') {
        yield { type: 'voter', status: 'PASS', confidence: judgeResult.confidence };
        return {
          status: 'PASS',
          actorOutput,
          judgeResult,
          attempts
        };
      }

      if (attempts <= this.maxRetries) {
        yield { type: 'voter', status: 'RETRYING', reason: 'Below threshold' };
        feedback = judgeResult.issues?.map(i => `[${i.severity}] ${i.description}`).join('\n') || '';
      }
    }

    yield { type: 'voter', status: 'FAIL', confidence: judgeResult.confidence };
    return {
      status: 'FAIL',
      actorOutput,
      judgeResult,
      attempts,
      feedback
    };
  }
}

// Factory
function createVoterLayer(ollamaUrl) {
  return new VoterLayer(ollamaUrl);
}

module.exports = {
  VoterLayer,
  createVoterLayer,
  JUDGE_SYSTEM_PROMPT,
  ACTOR_SYSTEM_PROMPT
};
