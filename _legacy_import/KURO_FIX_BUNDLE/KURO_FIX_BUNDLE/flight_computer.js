// ═══════════════════════════════════════════════════════════════════════════
// KURO OS v4.0 - FLIGHT COMPUTER
// XState-style state machine for request lifecycle management
// ═══════════════════════════════════════════════════════════════════════════

const EventEmitter = require('events');

// State definitions
const STATES = {
  IDLE: 'IDLE',
  SCANNING: 'SCANNING',
  BLOCKED: 'BLOCKED',
  ROUTING: 'ROUTING',
  PLANNING: 'PLANNING',
  VERIFYING: 'VERIFYING',
  REPLANNING: 'REPLANNING',
  SIMULATING: 'SIMULATING',
  COMMITTING: 'COMMITTING',
  EXECUTING: 'EXECUTING',
  REPORTING: 'REPORTING',
  ERROR: 'ERROR'
};

// Events that trigger transitions
const EVENTS = {
  REQUEST_RECEIVED: 'REQUEST_RECEIVED',
  SCAN_COMPLETE: 'SCAN_COMPLETE',
  THREAT_DETECTED: 'THREAT_DETECTED',
  ROUTE_COMPLETE: 'ROUTE_COMPLETE',
  PLAN_COMPLETE: 'PLAN_COMPLETE',
  JUDGE_PASS: 'JUDGE_PASS',
  JUDGE_FAIL: 'JUDGE_FAIL',
  SIM_PASS: 'SIM_PASS',
  SIM_FAIL: 'SIM_FAIL',
  COMMIT_COMPLETE: 'COMMIT_COMPLETE',
  EXECUTE_COMPLETE: 'EXECUTE_COMPLETE',
  REPORT_COMPLETE: 'REPORT_COMPLETE',
  ERROR: 'ERROR',
  ABORT: 'ABORT'
};

// State machine transition table
const TRANSITIONS = {
  [STATES.IDLE]: {
    [EVENTS.REQUEST_RECEIVED]: STATES.SCANNING
  },
  [STATES.SCANNING]: {
    [EVENTS.SCAN_COMPLETE]: STATES.ROUTING,
    [EVENTS.THREAT_DETECTED]: STATES.BLOCKED,
    [EVENTS.ERROR]: STATES.ERROR
  },
  [STATES.BLOCKED]: {
    // Terminal state - session ends
  },
  [STATES.ROUTING]: {
    [EVENTS.ROUTE_COMPLETE]: (context) => context.mode === 'dev' ? STATES.PLANNING : STATES.EXECUTING,
    [EVENTS.ERROR]: STATES.ERROR
  },
  [STATES.PLANNING]: {
    [EVENTS.PLAN_COMPLETE]: STATES.VERIFYING,
    [EVENTS.ERROR]: STATES.ERROR
  },
  [STATES.VERIFYING]: {
    [EVENTS.JUDGE_PASS]: STATES.SIMULATING,
    [EVENTS.JUDGE_FAIL]: STATES.REPLANNING,
    [EVENTS.ERROR]: STATES.ERROR
  },
  [STATES.REPLANNING]: {
    [EVENTS.PLAN_COMPLETE]: STATES.VERIFYING,
    [EVENTS.ERROR]: STATES.REPORTING // After retry limit, go to reporting with error
  },
  [STATES.SIMULATING]: {
    [EVENTS.SIM_PASS]: STATES.COMMITTING,
    [EVENTS.SIM_FAIL]: STATES.REPORTING, // Report simulation failure
    [EVENTS.ERROR]: STATES.ERROR
  },
  [STATES.COMMITTING]: {
    [EVENTS.COMMIT_COMPLETE]: STATES.REPORTING,
    [EVENTS.ERROR]: STATES.ERROR
  },
  [STATES.EXECUTING]: {
    [EVENTS.EXECUTE_COMPLETE]: STATES.REPORTING,
    [EVENTS.ERROR]: STATES.ERROR
  },
  [STATES.REPORTING]: {
    [EVENTS.REPORT_COMPLETE]: STATES.IDLE
  },
  [STATES.ERROR]: {
    [EVENTS.REPORT_COMPLETE]: STATES.IDLE
  }
};

class FlightComputer extends EventEmitter {
  constructor() {
    super();
    this.state = STATES.IDLE;
    this.context = {
      requestId: null,
      mode: 'main',
      messages: [],
      model: null,
      layers: [],
      actorOutput: null,
      judgeResult: null,
      simResult: null,
      retryCount: 0,
      maxRetries: 1,
      startTime: null,
      error: null
    };
    this.aborted = false;
  }

  // Get current state
  getState() {
    return this.state;
  }

  // Get current context
  getContext() {
    return { ...this.context };
  }

  // Initialize for new request
  initialize(requestId, messages, mode = 'main', options = {}) {
    this.state = STATES.IDLE;
    this.aborted = false;
    this.context = {
      requestId,
      mode,
      messages,
      model: options.model || null,
      skill: options.skill || null,
      temperature: options.temperature || 0.7,
      layers: [],
      actorOutput: null,
      judgeResult: null,
      simResult: null,
      retryCount: 0,
      maxRetries: 1,
      startTime: Date.now(),
      error: null,
      ...options
    };
    return this;
  }

  // Dispatch event to trigger state transition
  dispatch(event, payload = {}) {
    if (this.aborted && event !== EVENTS.ABORT) {
      return this;
    }

    const transitions = TRANSITIONS[this.state];
    if (!transitions) {
      console.warn(`[FlightComputer] No transitions from state: ${this.state}`);
      return this;
    }

    let nextState = transitions[event];
    if (!nextState) {
      // Check for wildcard abort
      if (event === EVENTS.ABORT) {
        this.aborted = true;
        this.state = STATES.REPORTING;
        this.context.error = 'Request aborted';
        this.emit('stateChange', { state: this.state, event, payload });
        return this;
      }
      console.warn(`[FlightComputer] Invalid transition: ${this.state} + ${event}`);
      return this;
    }

    // Handle dynamic transitions (functions)
    if (typeof nextState === 'function') {
      nextState = nextState(this.context);
    }

    const prevState = this.state;
    this.state = nextState;

    // Update context with payload
    Object.assign(this.context, payload);

    // Emit state change event
    this.emit('stateChange', {
      prevState,
      state: this.state,
      event,
      payload,
      context: this.getContext()
    });

    return this;
  }

  // Add layer result
  addLayer(layerNum, name, status, data = {}) {
    const layer = { layer: layerNum, name, status, data, timestamp: Date.now() };
    const existingIdx = this.context.layers.findIndex(l => l.layer === layerNum);
    if (existingIdx >= 0) {
      this.context.layers[existingIdx] = layer;
    } else {
      this.context.layers.push(layer);
    }
    this.emit('layer', layer);
    return layer;
  }

  // Set actor output
  setActorOutput(output) {
    this.context.actorOutput = output;
    this.emit('actorOutput', output);
    return this;
  }

  // Set judge result
  setJudgeResult(result) {
    this.context.judgeResult = result;
    this.emit('judgeResult', result);
    return this;
  }

  // Set simulation result
  setSimResult(result) {
    this.context.simResult = result;
    this.emit('simResult', result);
    return this;
  }

  // Increment retry count
  incrementRetry() {
    this.context.retryCount++;
    return this.context.retryCount <= this.context.maxRetries;
  }

  // Check if request is in dev mode
  isDevMode() {
    return this.context.mode === 'dev' || this.context.mode === 'exe';
  }

  // Abort the current request
  abort() {
    this.dispatch(EVENTS.ABORT);
    return this;
  }

  // Check if aborted
  isAborted() {
    return this.aborted;
  }

  // Get elapsed time
  getElapsedMs() {
    return this.context.startTime ? Date.now() - this.context.startTime : 0;
  }

  // Generate SSE event for current state
  toSSE() {
    return {
      type: 'state',
      state: this.state,
      context: {
        mode: this.context.mode,
        model: this.context.model,
        retryCount: this.context.retryCount,
        elapsedMs: this.getElapsedMs()
      }
    };
  }
}

// Factory function
function createFlightComputer() {
  return new FlightComputer();
}

module.exports = {
  FlightComputer,
  createFlightComputer,
  STATES,
  EVENTS
};
