var danger = [
    {p: /rm\s+-rf\s+\/(?!\w)/, n: "rm -rf /"},
    {p: /mkfs\.\w+\s+\/dev/, n: "mkfs"},
    {p: /dd\s+if=.+of=\/dev/, n: "dd"},
    {p: /wget.+\|\s*sh/, n: "wget|sh"},
    {p: /curl.+\|\s*bash/, n: "curl|bash"}
];
function fireControlCheck(content) {
    var safe = true;
    var message = "Clear";
    for (var i = 0; i < danger.length; i++) {
        if (danger[i].p.test(content)) { safe = false; message = danger[i].n; break; }
    }
    if (/(\b\w{3,}\b)(\s+\1){5,}/i.test(content)) { safe = false; message = "Token loop"; }
    return {safe: safe, message: message};
}
module.exports = {fireControlCheck: fireControlCheck};

// SMASH 3000 Integration
const { SmashProtocol, FIRE_CONTROL_STATE } = require('./smash_protocol.js');

const smash = new SmashProtocol();

function smashEngage(content, route, context, memory) {
  // ACQUIRE
  const target = smash.acquire(content);
  
  // LOCK
  const lockResult = smash.lock(target, route);
  if (!lockResult.locked) return { clear: false, ...lockResult };
  
  // TRACK
  const trackResult = smash.track(context, memory);
  
  // FIRE GATE
  if (!trackResult.readyToFire) {
    return {
      clear: false,
      state: FIRE_CONTROL_STATE.TRACKING,
      poh: trackResult.frame.poh,
      reason: 'TRACKING_INSUFFICIENT_POH'
    };
  }
  
  // CLEARED HOT
  const fireResult = smash.fire(trackResult.frame.poh);
  
  return {
    clear: fireResult.fired,
    state: fireResult.fired ? FIRE_CONTROL_STATE.FIRING : FIRE_CONTROL_STATE.TRACKING,
    poh: trackResult.frame.poh,
    mode: lockResult.mode,
    engagementData: fireResult
  };
}

function smashBDA(response, intent) {
  return smash.assessDamage(response, intent);
}

module.exports = { fireControlCheck, smashEngage, smashBDA };
