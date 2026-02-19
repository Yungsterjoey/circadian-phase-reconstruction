var crypto = require("crypto");
var rateMap = new Map();
function iffCheck(req) {
    var result = {authenticated: true, rateLimited: false, status: "FRIENDLY", clientId: null, requestCount: 0};
    var ip = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || (req.socket ? req.socket.remoteAddress : null) || "unknown";
    result.clientId = crypto.createHash("md5").update(ip).digest("hex").slice(0, 8);
    var now = Date.now();
    if (!rateMap.has(result.clientId)) {
        rateMap.set(result.clientId, {count: 1, start: now});
    } else {
        var d = rateMap.get(result.clientId);
        if (now - d.start > 60000) { d.count = 1; d.start = now; }
        else { d.count++; if (d.count > 60) { result.rateLimited = true; result.status = "THROTTLED"; } }
        result.requestCount = d.count;
    }
    return result;
}
module.exports = {iffCheck: iffCheck};
