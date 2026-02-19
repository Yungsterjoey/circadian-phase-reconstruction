function enhanceOutput(content) {
    var out = content;
    var blocks = (out.match(/```/g) || []).length;
    if (blocks % 2 !== 0) out = out + "\n```";
    out = out.replace(/\n{4,}/g, "\n\n");
    return out.trim();
}
module.exports = {enhanceOutput: enhanceOutput};
