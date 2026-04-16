// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Latent Belief Embedding z_t (§9)
// ═══════════════════════════════════════════════════════════════════════════
//
// z_{t+1} = α·z_t + (1 − α) · Σ softmax(V_i) · φ(x_i)
//
// This is KURO's pseudo-internal memory: a running weighted average of past
// solution embeddings, where weight ∝ softmax over their V scores. Frozen
// base model, so this lives outside the transformer — we just maintain a
// vector and prepend its top-k nearest-neighbour memory items to the prompt
// as structured context.
//
// Periodic reset to best-scoring solution embedding prevents drift (§9).
// ═══════════════════════════════════════════════════════════════════════════
//
// Dependencies
//   - Any async embedder:  embedFn(text) => Promise<number[]>
//     In KURO this is `nomic-embed-text` via Ollama, supplied by the caller.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const EPS = 1e-8;

// Softmax that handles large values without overflow
function softmax(arr) {
  if (!arr.length) return [];
  let max = -Infinity;
  for (const v of arr) if (v > max) max = v;
  const exps = arr.map(v => Math.exp(v - max));
  let sum = 0;
  for (const v of exps) sum += v;
  return exps.map(v => v / (sum + EPS));
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

function cosine(a, b) {
  const d = dot(a, b);
  const n = (norm(a) * norm(b)) + EPS;
  return d / n;
}

// Weighted average of vectors (all same dim). weights need not sum to 1.
function weightedMean(vectors, weights) {
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  let wsum = 0;
  for (let i = 0; i < vectors.length; i++) {
    const w = weights[i];
    wsum += w;
    for (let d = 0; d < dim; d++) out[d] += w * vectors[i][d];
  }
  if (wsum > EPS) for (let d = 0; d < dim; d++) out[d] /= wsum;
  return out;
}

class LatentState {
  // alpha: blending coefficient for z. Spec says "α" generically; 0.7 is
  // typical — slow decay so the state remembers the recent trajectory spine
  // while still tracking quality.
  //
  // resetEvery: N updates between periodic resets to best-ever embedding
  //   (§9 "Periodic reset to best solution embedding to prevent drift")
  constructor({ alpha = 0.7, resetEvery = 32, memoryCap = 64 } = {}) {
    this.alpha = alpha;
    this.resetEvery = resetEvery;
    this.memoryCap = memoryCap;
    this.z = null;             // current latent, lazy-init on first update
    this.updates = 0;
    this.bestV = -Infinity;
    this.bestEmbedding = null;
    this.memory = [];          // [{ embedding, V, x, t }]
  }

  // Update with a batch of candidate solutions and their V scores.
  // candidates: [{ embedding: number[], V: number, x: string }]
  step(candidates) {
    if (!candidates.length) return this.z;
    const embeddings = candidates.map(c => c.embedding);
    const vs = candidates.map(c => c.V);
    const weights = softmax(vs);
    const agg = weightedMean(embeddings, weights);

    if (!this.z) {
      this.z = agg;
    } else {
      for (let i = 0; i < this.z.length; i++) {
        this.z[i] = this.alpha * this.z[i] + (1 - this.alpha) * agg[i];
      }
    }

    // Track best-ever for drift reset
    for (const c of candidates) {
      if (c.V > this.bestV) {
        this.bestV = c.V;
        this.bestEmbedding = c.embedding.slice();
      }
      this.memory.push({ embedding: c.embedding, V: c.V, x: c.x, t: Date.now() });
      if (this.memory.length > this.memoryCap) this.memory.shift();
    }

    this.updates += 1;
    if (this.updates % this.resetEvery === 0 && this.bestEmbedding) {
      // Periodic reset — §9 drift prevention
      this.z = this.bestEmbedding.slice();
    }
    return this.z;
  }

  // Retrieve top-k memory items by cosine similarity to current z.
  // Used to build context for the next prompt.
  recall(k = 3) {
    if (!this.z || !this.memory.length) return [];
    const scored = this.memory.map(m => ({ m, s: cosine(this.z, m.embedding) }));
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, k).map(({ m, s }) => ({
      x: m.x, V: m.V, similarity: s, t: m.t
    }));
  }

  snapshot() {
    return {
      alpha: this.alpha, resetEvery: this.resetEvery,
      memoryCap: this.memoryCap, updates: this.updates, bestV: this.bestV,
      hasZ: !!this.z, dim: this.z ? this.z.length : 0,
      memorySize: this.memory.length
    };
  }
}

module.exports = {
  LatentState,
  softmax,
  cosine,
  weightedMean
};
