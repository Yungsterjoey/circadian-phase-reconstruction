var fs = require("fs");
var crypto = require("crypto");
var path = require("path");

var LIBRARY_PATH = "/var/www/kuro/library";
var GRIMOIRE_FILE = path.join(LIBRARY_PATH, "grimoire.json");

function ensureLibrary() {
    if (!fs.existsSync(LIBRARY_PATH)) {
        fs.mkdirSync(LIBRARY_PATH, {recursive: true});
    }
    if (!fs.existsSync(GRIMOIRE_FILE)) {
        fs.writeFileSync(GRIMOIRE_FILE, JSON.stringify({tablets: [], index: {}}, null, 2));
    }
}

function loadGrimoire() {
    ensureLibrary();
    try {
        var data = fs.readFileSync(GRIMOIRE_FILE, "utf8");
        return JSON.parse(data);
    } catch (e) {
        return {tablets: [], index: {}};
    }
}

function saveGrimoire(grimoire) {
    ensureLibrary();
    fs.writeFileSync(GRIMOIRE_FILE, JSON.stringify(grimoire, null, 2));
}

function generateTabletKey(query) {
    var normalized = query.toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .sort()
        .join(" ");
    return crypto.createHash("md5").update(normalized).digest("hex").slice(0, 12);
}

function extractKeywords(query) {
    var stopwords = ["a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare", "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "and", "but", "if", "or", "because", "until", "while", "although", "though", "after", "before", "when", "whenever", "where", "wherever", "whether", "which", "who", "whoever", "whom", "whose", "what", "whatever", "this", "that", "these", "those", "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours", "yourself", "yourselves", "he", "him", "his", "himself", "she", "her", "hers", "herself", "it", "its", "itself", "they", "them", "their", "theirs", "themselves", "write", "create", "make", "build", "code", "script", "function", "please", "help"];
    var words = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
    var keywords = [];
    for (var i = 0; i < words.length; i++) {
        if (words[i].length > 2 && stopwords.indexOf(words[i]) === -1) {
            keywords.push(words[i]);
        }
    }
    return keywords;
}

function searchTablets(query) {
    var grimoire = loadGrimoire();
    var keywords = extractKeywords(query);
    var candidates = [];

    for (var i = 0; i < grimoire.tablets.length; i++) {
        var tablet = grimoire.tablets[i];
        var score = 0;
        for (var j = 0; j < keywords.length; j++) {
            if (tablet.keywords && tablet.keywords.indexOf(keywords[j]) !== -1) {
                score++;
            }
        }
        if (score > 0) {
            candidates.push({tablet: tablet, score: score});
        }
    }

    candidates.sort(function(a, b) { return b.score - a.score; });

    if (candidates.length > 0 && candidates[0].score >= Math.floor(keywords.length * 0.6)) {
        return candidates[0].tablet;
    }
    return null;
}

function inscribe(query, response, intent, lang) {
    var grimoire = loadGrimoire();
    var key = generateTabletKey(query);
    var keywords = extractKeywords(query);

    for (var i = 0; i < grimoire.tablets.length; i++) {
        if (grimoire.tablets[i].key === key) {
            grimoire.tablets[i].response = response;
            grimoire.tablets[i].accessCount++;
            grimoire.tablets[i].lastAccess = Date.now();
            saveGrimoire(grimoire);
            return {action: "updated", key: key};
        }
    }

    var tablet = {
        key: key,
        query: query,
        keywords: keywords,
        response: response,
        intent: intent,
        lang: lang || "text",
        created: Date.now(),
        lastAccess: Date.now(),
        accessCount: 1
    };

    grimoire.tablets.push(tablet);
    grimoire.index[key] = grimoire.tablets.length - 1;
    saveGrimoire(grimoire);

    return {action: "inscribed", key: key};
}

function recall(query) {
    var tablet = searchTablets(query);
    if (tablet) {
        var grimoire = loadGrimoire();
        for (var i = 0; i < grimoire.tablets.length; i++) {
            if (grimoire.tablets[i].key === tablet.key) {
                grimoire.tablets[i].accessCount++;
                grimoire.tablets[i].lastAccess = Date.now();
                saveGrimoire(grimoire);
                break;
            }
        }
        return {found: true, tablet: tablet};
    }
    return {found: false, tablet: null};
}

function getStats() {
    var grimoire = loadGrimoire();
    return {
        totalTablets: grimoire.tablets.length,
        mostAccessed: grimoire.tablets.sort(function(a, b) { return b.accessCount - a.accessCount; }).slice(0, 5)
    };
}

module.exports = {
    inscribe: inscribe,
    recall: recall,
    searchTablets: searchTablets,
    getStats: getStats
};
