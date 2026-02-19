var fs = require('fs');
var path = require('path');
var MEMORY_DIR = '/var/www/kuro/data/sessions';
var sessions = new Map();
if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });

function getSession(id) {
  if (!sessions.has(id)) {
    var fp = path.join(MEMORY_DIR, id + '.json');
    if (fs.existsSync(fp)) {
      try { sessions.set(id, JSON.parse(fs.readFileSync(fp, 'utf8'))); }
      catch(e) { sessions.set(id, { history: [], lastAccess: Date.now() }); }
    } else { sessions.set(id, { history: [], lastAccess: Date.now() }); }
  }
  var s = sessions.get(id);
  s.lastAccess = Date.now();
  return s;
}

function saveSession(id) {
  var s = sessions.get(id);
  if (s) fs.writeFileSync(path.join(MEMORY_DIR, id + '.json'), JSON.stringify(s, null, 2));
}

function addToHistory(id, role, content) {
  var s = getSession(id);
  s.history.push({ role: role, content: content, timestamp: Date.now() });
  if (s.history.length > 50) s.history = s.history.slice(-50);
  saveSession(id);
}

function getContext(id) {
  var s = getSession(id);
  return s.history.map(function(h) { return { role: h.role, content: h.content }; });
}

function clearSession(id) {
  sessions.delete(id);
  var fp = path.join(MEMORY_DIR, id + '.json');
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

module.exports = { getSession: getSession, addToHistory: addToHistory, getContext: getContext, clearSession: clearSession, saveSession: saveSession };
