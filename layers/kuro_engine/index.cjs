// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Public API
// ═══════════════════════════════════════════════════════════════════════════
//
// Single import point for the rest of the application. Everything the server
// or training scripts need is re-exported here — no deep paths into individual
// module files.
//
//   const engine = require('./layers/kuro_engine');
//   const e = new engine.Engine(deps, cfg);
//   const result = await e.run(goal);
//
// For training-data export, pull the advantage pipeline + trajectory tools
// directly from here rather than wading through submodules.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

// Core orchestrator
const { Engine, ENGINE_DEFAULTS }   = require('./engine.cjs');

// State containers
const { SystemState }               = require('./state_machine.cjs');
const { LatentState }               = require('./latent_state.cjs');

// Value + advantage pipeline
const { ValueFunction,
        METRIC_KEYS,
        gradeSyntax,
        gradeEfficiency,
        gradeConstraints }          = require('./value_function.cjs');
const advantage                     = require('./advantage.cjs');

// Prompt format + tools + search
const { buildControllerPrompt,
        parseControllerOutput,
        BLOCK_TAGS,
        TOKEN_WEIGHTS }             = require('./prompts.cjs');
const { TOOL_NAMES,
        TOOL_CATALOG,
        HANDLERS,
        dispatch: dispatchTool }    = require('./tools.cjs');
const { SearchBudget,
        weightedTopK,
        weightedPick,
        weightedArgmaxSoft }        = require('./search.cjs');

// Budget + stats + safeguards
const { ComputeBudget }             = require('./compute_budget.cjs');
const { RunningStats, clip, EPS }   = require('./running_stats.cjs');
const { TrajectoryLogger,
        TRAJ_DIR }                  = require('./trajectory_log.cjs');
const { HealthMonitor,
        maskedPlanForLogging,
        xorshift32 }                = require('./safeguards.cjs');

module.exports = {
  // Primary
  Engine,
  ENGINE_DEFAULTS,

  // State
  SystemState,
  LatentState,

  // Valuation + advantage
  ValueFunction,
  METRIC_KEYS,
  gradeSyntax,
  gradeEfficiency,
  gradeConstraints,
  advantage,

  // Prompting + tools + search
  buildControllerPrompt,
  parseControllerOutput,
  BLOCK_TAGS,
  TOKEN_WEIGHTS,
  TOOL_NAMES,
  TOOL_CATALOG,
  HANDLERS,
  dispatchTool,
  SearchBudget,
  weightedTopK,
  weightedPick,
  weightedArgmaxSoft,

  // Budget + infra
  ComputeBudget,
  RunningStats,
  clip,
  EPS,
  TrajectoryLogger,
  TRAJ_DIR,
  HealthMonitor,
  maskedPlanForLogging,
  xorshift32
};
