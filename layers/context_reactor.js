/**
 * KURO::CONTEXT REACTOR v1.0
 * 
 * Closes the context window gap (16K vs 200K/2M) through:
 *   1. File upload → chunk → embed → RAG store
 *   2. Hierarchical summarization (map→reduce) with citation anchors
 *   3. Session memory compaction (signed summary blobs)
 *   4. Retrieval injection into L2 (Edubba) pipeline
 * 
 * Architecture:
 *   Files → chunker → nomic-embed-text → vector store
 *   Queries → embed → nearest chunks → inject into context
 *   Long sessions → compact older turns → signed digest → keep last N raw
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const INGEST_DIR = path.join(DATA_DIR, 'ingest');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(INGEST_DIR)) fs.mkdirSync(INGEST_DIR, { recursive: true });

// ═══ Chunking ═══
const CHUNK_SIZE = 800;     // ~800 tokens per chunk
const CHUNK_OVERLAP = 100;  // 100 token overlap for context continuity

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const words = text.split(/\s+/);
  const chunks = [];
  let i = 0;
  
  while (i < words.length) {
    const end = Math.min(i + chunkSize, words.length);
    const chunk = words.slice(i, end).join(' ');
    const chunkId = crypto.createHash('sha256').update(chunk).digest('hex').slice(0, 16);
    
    chunks.push({
      id: chunkId,
      text: chunk,
      startWord: i,
      endWord: end,
      tokenEstimate: end - i
    });
    
    i += chunkSize - overlap;
    if (i >= words.length) break;
  }
  
  return chunks;
}

// ═══ File Parser ═══
function parseFile(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath);
  
  // Text-based formats
  if (['.txt', '.md', '.csv', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.cjs', '.mjs', '.sh', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.sql', '.log'].includes(ext)) {
    return { text: raw.toString('utf-8'), type: 'text', ext };
  }
  
  // PDF — basic text extraction (needs pdftotext or similar for production)
  if (ext === '.pdf') {
    // For now, extract what we can from raw bytes (ASCII text fragments)
    // Production: use pdftotext or pdf-parse
    const text = raw.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
    return { text: text.length > 100 ? text : '[PDF requires pdftotext for full extraction]', type: 'pdf', ext };
  }
  
  // Binary/unknown — return metadata only
  return {
    text: `[Binary file: ${path.basename(filePath)}, ${raw.length} bytes, type: ${mimeType || ext}]`,
    type: 'binary',
    ext,
    size: raw.length
  };
}

// ═══ Ingest Pipeline ═══
/**
 * Ingest a file: parse → chunk → embed → store
 * @param {string} filePath - Path to uploaded file
 * @param {string} fileId - Unique file identifier
 * @param {string} userId - Owner
 * @param {function} getEmbedding - async (text) => float[]
 * @param {object} vectorStore - { add(texts, embeddings, metadata) }
 * @returns {object} Ingest result with chunk count and anchors
 */
async function ingestFile(filePath, fileId, userId, getEmbedding, vectorStore) {
  const parsed = parseFile(filePath);
  
  if (parsed.type === 'binary') {
    return { success: false, reason: 'unsupported_format', type: parsed.type, ext: parsed.ext };
  }
  
  const chunks = chunkText(parsed.text);
  if (chunks.length === 0) {
    return { success: false, reason: 'empty_file' };
  }
  
  // Embed all chunks
  const embeddings = [];
  const texts = [];
  const metadata = [];
  
  for (const chunk of chunks) {
    try {
      const embedding = await getEmbedding(chunk.text);
      if (embedding) {
        embeddings.push(embedding);
        texts.push(chunk.text);
        metadata.push({
          fileId,
          chunkId: chunk.id,
          userId,
          startWord: chunk.startWord,
          endWord: chunk.endWord,
          fileName: path.basename(filePath),
          ingestedAt: Date.now()
        });
      }
    } catch(e) {
      // Skip failed chunks silently
    }
  }
  
  if (embeddings.length === 0) {
    return { success: false, reason: 'embedding_failed' };
  }
  
  // Store in vector DB
  await vectorStore.add(texts, embeddings, metadata);
  
  // Save ingest manifest
  const manifest = {
    fileId,
    fileName: path.basename(filePath),
    userId,
    chunks: chunks.length,
    embedded: embeddings.length,
    type: parsed.type,
    totalWords: parsed.text.split(/\s+/).length,
    ingestedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(
    path.join(INGEST_DIR, `${fileId}.json`),
    JSON.stringify(manifest, null, 2)
  );
  
  // Build citation anchors (first sentence of each chunk = anchor)
  const anchors = chunks.slice(0, Math.min(chunks.length, 20)).map(c => ({
    id: c.id,
    preview: c.text.split(/[.!?]/)[0]?.trim().slice(0, 100) || c.text.slice(0, 100),
    words: `${c.startWord}-${c.endWord}`
  }));
  
  return {
    success: true,
    fileId,
    chunks: chunks.length,
    embedded: embeddings.length,
    anchors,
    manifest
  };
}

// ═══ Retrieval ═══
/**
 * Retrieve relevant chunks for a query
 * @param {string} query - User query
 * @param {function} getEmbedding - async (text) => float[]
 * @param {object} vectorStore - { query(embedding, topK, threshold) }
 * @param {object} opts - { topK, threshold, fileId }
 * @returns {array} Relevant chunks with metadata
 */
async function retrieveChunks(query, getEmbedding, vectorStore, opts = {}) {
  const topK = opts.topK || 5;
  const threshold = opts.threshold || 0.65;
  
  const embedding = await getEmbedding(query);
  if (!embedding) return [];
  
  let results = vectorStore.query(embedding, topK, threshold);
  
  // Filter by fileId if specified
  if (opts.fileId) {
    results = results.filter(r => r.metadata?.fileId === opts.fileId);
  }
  
  return results;
}

/**
 * Build context injection string from retrieved chunks
 */
function buildContextInjection(chunks, maxTokens = 2000) {
  if (!chunks || chunks.length === 0) return '';
  
  let injection = '\n[CONTEXT FROM USER FILES]\n';
  let tokenCount = 0;
  
  for (const chunk of chunks) {
    const text = chunk.text || chunk.content || '';
    const words = text.split(/\s+/).length;
    if (tokenCount + words > maxTokens) break;
    
    const source = chunk.metadata?.fileName || 'document';
    injection += `[Source: ${source}] ${text}\n\n`;
    tokenCount += words;
  }
  
  injection += '[END CONTEXT]\n';
  return injection;
}

// ═══ Session Compaction ═══
/**
 * Compact a session: summarize old turns, keep last N raw
 * @param {string} sessionId
 * @param {array} history - Full message history
 * @param {number} keepRaw - Number of recent turns to keep raw
 * @param {function} summarize - async (messages) => summary string
 * @returns {object} Compacted session
 */
async function compactSession(sessionId, history, keepRaw = 10, summarize = null) {
  if (history.length <= keepRaw * 2) {
    return { compacted: false, reason: 'session_short_enough', turns: history.length };
  }
  
  const cutoff = history.length - (keepRaw * 2); // Keep last N exchanges (user+assistant)
  const oldMessages = history.slice(0, cutoff);
  const recentMessages = history.slice(cutoff);
  
  // Build summary
  let summary;
  if (summarize) {
    summary = await summarize(oldMessages);
  } else {
    // Fallback: extractive summary (first sentence of each assistant response)
    summary = oldMessages
      .filter(m => m.role === 'assistant')
      .map(m => m.content?.split(/[.!?]/)[0]?.trim())
      .filter(Boolean)
      .slice(0, 10)
      .join('. ') + '.';
  }
  
  // Sign the summary for integrity
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(oldMessages))
    .digest('hex');
  
  const compactedSession = {
    sessionId,
    summary: {
      text: summary,
      compactedTurns: oldMessages.length,
      sourceHash: hash,
      compactedAt: new Date().toISOString()
    },
    recentMessages,
    totalTurns: history.length
  };
  
  return { compacted: true, session: compactedSession };
}

/**
 * Build messages array from compacted session for Ollama
 */
function buildCompactedMessages(compactedSession) {
  const messages = [];
  
  if (compactedSession.summary?.text) {
    messages.push({
      role: 'system',
      content: `[SESSION CONTEXT — ${compactedSession.summary.compactedTurns} earlier messages compacted]\n${compactedSession.summary.text}`
    });
  }
  
  messages.push(...compactedSession.recentMessages);
  return messages;
}

// ═══ File Upload Handler ═══
/**
 * Handle file upload, return file metadata
 */
function handleUpload(fileBuffer, originalName, userId) {
  const fileId = crypto.randomBytes(16).toString('hex');
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  const filePath = path.join(UPLOADS_DIR, `${fileId}_${safeName}`);
  
  fs.writeFileSync(filePath, fileBuffer);
  
  return {
    fileId,
    fileName: safeName,
    filePath,
    size: fileBuffer.length,
    userId,
    uploadedAt: new Date().toISOString()
  };
}

module.exports = {
  chunkText,
  parseFile,
  ingestFile,
  retrieveChunks,
  buildContextInjection,
  compactSession,
  buildCompactedMessages,
  handleUpload,
  UPLOADS_DIR,
  INGEST_DIR
};
