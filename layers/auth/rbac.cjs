'use strict';
/**
 * KURO::RBAC v1 — Role-Based Access Control
 * Phase 8: Enterprise Hardening
 *
 * Role hierarchy (ascending):
 *   viewer(0) < developer(1) < admin(2) < operator(3)
 *
 * Tier → default role:
 *   free      → viewer
 *   pro       → developer
 *   sovereign → operator
 *
 * is_admin=true → admin (regardless of tier)
 *
 * All middleware degrades gracefully.
 */

const ROLE_LEVEL = {
  viewer:    0,
  developer: 1,
  admin:     2,
  operator:  3,
};

// Minimum role required for each protected action
const ACTION_ROLES = {
  'vfs.write':          'developer',
  'vfs.delete':         'developer',
  'runner.spawn':       'developer',
  'git.apply':          'developer',
  'git.branch':         'developer',
  'git.rollback':       'developer',
  'web.mode':           'developer',
  'tool.invoke':        'developer',
  'admin.users':        'admin',
  'admin.impersonate':  'operator',
  'search':             'viewer',
};

/**
 * Get the effective role for a user object.
 */
function getRole(user) {
  if (!user) return 'viewer';
  if (user.canAdmin || user.is_admin) return 'admin';
  if (user.tier === 'sovereign') return 'operator';
  if (user.tier === 'pro') return 'developer';
  return 'viewer';
}

/**
 * Check if a user can perform an action.
 * Returns true for unlisted actions (not restricted).
 */
function canDo(user, action) {
  const minRole = ACTION_ROLES[action];
  if (!minRole) return true;
  return (ROLE_LEVEL[getRole(user)] || 0) >= (ROLE_LEVEL[minRole] || 0);
}

/**
 * Express middleware: require a minimum role level.
 */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const userRole = getRole(req.user);
    if ((ROLE_LEVEL[userRole] || 0) >= (ROLE_LEVEL[minRole] || 0)) return next();
    return res.status(403).json({
      error: 'Insufficient role',
      required: minRole,
      current: userRole,
    });
  };
}

/**
 * Express middleware: require permission for a named action.
 */
function requireAction(action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (canDo(req.user, action)) return next();
    return res.status(403).json({
      error: 'Permission denied',
      action,
      required: ACTION_ROLES[action] || 'developer',
      current: getRole(req.user),
    });
  };
}

module.exports = { ROLE_LEVEL, ACTION_ROLES, getRole, canDo, requireRole, requireAction };
