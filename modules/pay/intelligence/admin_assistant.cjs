'use strict';
// §4.5 — Henry's admin NL interface. gemma4:e4b with tool calls (JSON protocol).
// Two-turn loop: planner emits tool spec, executor returns data, synthesiser answers.
const { BRAIN, chat, safeParse } = require('./models.cjs');
const { wrap } = require('./prompt_safety.cjs');
const tools = require('./admin_tools.cjs');

const PLANNER_SYSTEM = [
  'You are the KUROPay admin assistant. You answer questions by calling ONE read-only tool.',
  'JSON only, no markdown. Schema: {"tool":string,"args":object}.',
  `Available tools: ${JSON.stringify(tools.listToolsForModel())}.`,
  'Never invent tools. If no tool fits, return {"tool":"none","args":{}}.',
].join(' ');

const SYNTH_SYSTEM = [
  'Given a question and a tool result, write a concise answer for Henry (max 4 short bullets).',
  'JSON only. Schema: {"answer":string}.',
].join(' ');

const FAIL = { answer: 'Query failed — try rephrasing.' };

let _modelFn = async (cfg, system, user) => chat(cfg, system, user);

async function ask(question) {
  try {
    const planRaw = await _modelFn(BRAIN, PLANNER_SYSTEM, wrap(question));
    const plan = safeParse(planRaw, null);
    if (!plan || !plan.tool || plan.tool === 'none') return FAIL;

    const result = tools.invoke(plan.tool, plan.args || {});
    if (!result.ok) return FAIL;

    const synthRaw = await _modelFn(BRAIN, SYNTH_SYSTEM, { question, tool: plan.tool, result: result.data });
    const synth = safeParse(synthRaw, null);
    if (!synth || !synth.answer) return FAIL;
    return { answer: synth.answer, tool: plan.tool, data: result.data };
  } catch (_) {
    return FAIL;
  }
}

module.exports = { ask, _setModelForTest: fn => { _modelFn = fn; } };
