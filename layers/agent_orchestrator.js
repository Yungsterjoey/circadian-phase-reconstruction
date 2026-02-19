/**
 * KURO::ORCHESTRATOR v1.0
 * L5 replacement — policy engine + agent dispatch
 * Routes semantic intent → scoped agent with permission gates
 */

const AGENTS = {
  insights: {
    id: 'insights',
    name: 'Agent:Insights',
    skills: ['read', 'compute'],
    modes: ['main'],
    description: 'Conversational, Q&A, explanations — read-only'
  },
  actions: {
    id: 'actions',
    name: 'Agent:Actions',
    skills: ['read', 'write', 'exec', 'compute'],
    modes: ['dev'],
    description: 'Code generation, file ops, system commands — full access'
  },
  analysis: {
    id: 'analysis',
    name: 'Agent:Analysis',
    skills: ['read', 'compute', 'aggregate'],
    modes: ['bloodhound', 'war_room'],
    description: 'Deep research, RAG queries, sensor data, strategic planning'
  }
};

const SKILL_PERMISSIONS = {
  read:      { level: 0, desc: 'Read files, sessions, configs' },
  compute:   { level: 0, desc: 'Math, reasoning, formatting' },
  aggregate: { level: 1, desc: 'Query across sessions, vector stores, metrics' },
  write:     { level: 2, desc: 'Create/modify files within sandbox' },
  exec:      { level: 3, desc: 'Execute terminal commands (allowlisted)' }
};

// Intent → Agent mapping
const INTENT_ROUTES = {
  chat:       'insights',
  general:    'insights',
  greeting:   'insights',
  question:   'insights',
  explain:    'insights',
  nsfw:       'insights',
  dev:        'actions',
  code:       'actions',
  fix:        'actions',
  create:     'actions',
  deploy:     'actions',
  bloodhound: 'analysis',
  war_room:   'analysis',
  analyze:    'analysis',
  search:     'analysis',
  compare:    'analysis',
  sensor:     'analysis'
};

/**
 * Route to agent with policy enforcement
 * @param {string} intent - from semantic_router
 * @param {string} requestedMode - explicit mode from client ('main','dev','bloodhound','war_room')
 * @param {object} userPermissions - { devAllowed: bool, ... }
 * @returns {{ agent, mode, downgraded, reason?, skillGates }}
 */
function routeToAgent(intent, requestedMode, userPermissions) {
  // Explicit mode override takes priority
  let agentId;
  if (requestedMode && requestedMode !== 'main') {
    const modeAgent = Object.entries(AGENTS).find(([_, a]) => a.modes.includes(requestedMode));
    agentId = modeAgent ? modeAgent[0] : INTENT_ROUTES[intent] || 'insights';
  } else {
    agentId = INTENT_ROUTES[intent] || 'insights';
  }

  const agent = AGENTS[agentId];
  const maxUserLevel = userPermissions.devAllowed ? 3 : 1;
  const requiredLevel = Math.max(...agent.skills.map(s => SKILL_PERMISSIONS[s]?.level || 0));

  // Policy gate: downgrade if user lacks permissions
  if (requiredLevel > maxUserLevel) {
    const fallback = AGENTS.insights;
    return {
      agent: fallback,
      agentId: 'insights',
      mode: 'main',
      downgraded: true,
      reason: `${agent.name} requires level ${requiredLevel}, user has ${maxUserLevel}`,
      skillGates: buildSkillGates('insights')
    };
  }

  const resolvedMode = agent.modes[0] || 'main';
  return {
    agent,
    agentId,
    mode: requestedMode || resolvedMode,
    downgraded: false,
    skillGates: buildSkillGates(agentId)
  };
}

/**
 * Build skill gate object for an agent
 */
function buildSkillGates(agentId) {
  const agent = AGENTS[agentId];
  if (!agent) return { canRead: false, canWrite: false, canExec: false, canCompute: false, canAggregate: false };
  return {
    canRead:      agent.skills.includes('read'),
    canWrite:     agent.skills.includes('write'),
    canExec:      agent.skills.includes('exec'),
    canCompute:   agent.skills.includes('compute'),
    canAggregate: agent.skills.includes('aggregate')
  };
}

/**
 * Check if a specific skill is allowed for an agent
 */
function checkSkill(agentId, skill) {
  const agent = AGENTS[agentId];
  if (!agent) return false;
  return agent.skills.includes(skill);
}

module.exports = { AGENTS, SKILL_PERMISSIONS, INTENT_ROUTES, routeToAgent, buildSkillGates, checkSkill };
