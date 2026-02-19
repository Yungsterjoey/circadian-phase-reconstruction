var crypto = require("crypto");

function identifyBlockType(code, lang) {
    if (lang === "bash" || lang === "sh" || lang === "shell") {
        if (code.includes("pip install") || code.includes("npm install") || code.includes("apt")) return "DEPENDENCY";
        if (code.includes("python ") || code.includes("node ") || code.includes("./")) return "EXECUTION";
        if (code.includes("cat >") || code.includes("echo")) return "INJECTION";
        if (code.includes("curl") || code.includes("wget")) return "RETRIEVAL";
        return "TERMINAL";
    }
    if (lang === "sql") return "QUERY";
    if (lang === "json" || lang === "yaml" || lang === "toml") return "CONFIG";
    if (lang === "html" || lang === "css") return "INTERFACE";
    if (code.includes("import ") || code.includes("require(") || code.includes("from ")) return "SOURCE";
    if (code.includes("function ") || code.includes("def ") || code.includes("class ")) return "DEFINITION";
    if (code.includes("test") || code.includes("assert") || code.includes("expect")) return "VALIDATION";
    return "ARTIFACT";
}

function purify(content, intent) {
    if (!content) return "";
    var pure = content;

    // 1. THE MONOLITH PROTOCOL (Semantic Labels)
    var codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    var matches = [];
    var match;
    while ((match = codeBlockRegex.exec(pure)) !== null) {
        matches.push({lang: match[1], code: match[2], full: match[0]});
    }

    if (matches.length > 1 && (intent === "code" || intent === "analyze")) {
        var dominantLang = matches[0].lang || "text";
        var monolithCode = "";
        
        for (var i = 0; i < matches.length; i++) {
            pure = pure.replace(matches[i].full, "");
            var label = identifyBlockType(matches[i].code, matches[i].lang);
            var langLabel = (matches[i].lang || "TEXT").toUpperCase();
            monolithCode += "\n# --- " + label + ": " + langLabel + " ---\n" + matches[i].code.trim() + "\n";
        }
        
        pure = pure.replace(/\[?FRAGMENT[_\s]*MERGED\]?/g, "").trim();
        pure = "```" + dominantLang + "\n" + monolithCode.trim() + "\n```";
    }

    // 2. STRIP THE MASK (Remove fluff)
    if (intent === "code") {
        pure = pure.replace(/^(Here'?s?|Sure|Of course|Certainly|I'?d be happy to)[^.!?\n]*[.!?\n]/gi, "");
        pure = pure.replace(/^(This|The following)[^.!?\n]*(code|script|function)[^.!?\n]*[.!?\n]/gi, "");
        pure = pure.replace(/Feel free to[^.!?\n]*[.!?\n]/gi, "");
        pure = pure.replace(/Let me know if[^.!?\n]*[.!?\n]/gi, "");
    }

    // 3. THE CARTOUCHE
    if (intent === "code" || intent === "analyze") {
        var signet = crypto.createHash("sha256").update(pure).digest("hex").slice(0, 8);
        pure = pure.trim() + "\n\n// KURO.OS Signet: " + signet;
    }

    return pure.trim();
}

function calculateWeight(content) {
    var codeMatch = content.match(/```[\s\S]*?```/g);
    var codeLength = 0;
    if (codeMatch) {
        for (var i = 0; i < codeMatch.length; i++) {
            codeLength += codeMatch[i].length;
        }
    }
    var totalLength = content.length;
    if (totalLength === 0) return 0;
    return Math.round((codeLength / totalLength) * 100);
}

module.exports = {purify: purify, calculateWeight: calculateWeight};
