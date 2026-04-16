# ═══════════════════════════════════════════════════════════════════════════
# KURO::TRAINING — Token-level weighting (Spec §8)
# ═══════════════════════════════════════════════════════════════════════════
#
# Every token in the controller's structured output carries a block-level
# weight that modulates its CE contribution:
#
#   REASONING   → 1.0
#   PLAN        → 2.5   (15% of plan args masked → taught as <MASKED>)
#   DELTA       → 2.0
#   NEXT_STATE  → 1.5
#   FILLER      → 0.1   (everything else — STATE, whitespace, stray text)
#
# The weights table mirrors `layers/kuro_engine/prompts.cjs TOKEN_WEIGHTS`.
# Keep them aligned — a drift between JS-emitted logs and Python-trained
# model is the kind of "silent correctness bug" the red team warned about.
#
# Produces, for each sample, a `token_weights` tensor the same length as
# `input_ids`, used by `awbc_loss.py`.
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

import numpy as np

TOKEN_WEIGHTS: dict[str, float] = {
    "REASONING":  1.0,
    "PLAN":       2.5,
    "DELTA":      2.0,
    "NEXT_STATE": 1.5,
    "FILLER":     0.1,
    "STATE":      0.1,   # STATE is a restatement — treated as filler for loss
}

PLAN_MASK_PROB = 0.15

BLOCK_TAGS = ("STATE", "REASONING", "PLAN", "DELTA", "NEXT_STATE")


# ── Deterministic PRNG (mirror of safeguards.cjs xorshift32) ──────────────
# Same seed → same mask pattern. This lets training/inference agree on which
# PLAN arg positions were masked at log time, which matters for token-level
# CE attribution.
def xorshift32(seed: int):
    s = [seed & 0xFFFFFFFF or 1]

    def _next() -> float:
        v = s[0]
        v ^= (v << 13) & 0xFFFFFFFF
        v ^= (v >> 17)
        v ^= (v << 5)  & 0xFFFFFFFF
        s[0] = v & 0xFFFFFFFF
        return s[0] / 0xFFFFFFFF

    return _next


# ── Block span detection ───────────────────────────────────────────────────
@dataclass
class BlockSpan:
    tag: str         # e.g. "REASONING"
    start: int       # char offset in controller_text
    end: int         # exclusive


_BLOCK_RE = {
    tag: re.compile(rf"<{tag}>([\s\S]*?)</{tag}>", re.IGNORECASE)
    for tag in BLOCK_TAGS
}


def find_block_spans(text: str) -> list[BlockSpan]:
    """Returns the *content* spans (excluding the enclosing tags) in text order."""
    spans: list[BlockSpan] = []
    for tag, rx in _BLOCK_RE.items():
        for m in rx.finditer(text):
            spans.append(BlockSpan(tag=tag, start=m.start(1), end=m.end(1)))
    spans.sort(key=lambda s: s.start)
    return spans


def char_to_weight_array(text: str) -> np.ndarray:
    """One weight per character. Inside a block → block weight; outside → FILLER."""
    w = np.full(len(text), TOKEN_WEIGHTS["FILLER"], dtype=np.float32)
    for span in find_block_spans(text):
        w[span.start:span.end] = TOKEN_WEIGHTS.get(span.tag, TOKEN_WEIGHTS["FILLER"])
    return w


# ── Token-level weights via offset mapping ─────────────────────────────────
# Requires a tokenizer that supports `return_offsets_mapping=True` (all HF
# fast tokenizers do).
def token_weights_for(
    text: str,
    tokenizer,
    *,
    max_length: int | None = None,
) -> tuple[list[int], np.ndarray]:
    """Tokenise text and return (input_ids, per-token weights).

    The weight for a token is the MEAN of per-character weights spanned by the
    token's offset range — this gives natural decay at block boundaries
    instead of a hard cliff on a single BPE piece.
    """
    enc = tokenizer(
        text,
        return_offsets_mapping=True,
        add_special_tokens=False,
        truncation=max_length is not None,
        max_length=max_length,
    )
    ids: list[int] = enc["input_ids"]
    offsets: list[tuple[int, int]] = enc["offset_mapping"]
    char_w = char_to_weight_array(text)

    tok_w = np.empty(len(ids), dtype=np.float32)
    for i, (a, b) in enumerate(offsets):
        if b <= a or a >= len(char_w):
            tok_w[i] = TOKEN_WEIGHTS["FILLER"]
            continue
        tok_w[i] = float(char_w[a:b].mean()) if b > a else TOKEN_WEIGHTS["FILLER"]
    return ids, tok_w


# ── PLAN masking applied to a string ───────────────────────────────────────
# Used only when the log did NOT already carry `plan_masked`. Parity with
# safeguards.cjs maskedPlanForLogging — same PRNG, same drop probability.
def apply_plan_mask(plan_json_text: str, *, seed: int, drop_prob: float = PLAN_MASK_PROB) -> str:
    """Walk a JSON-array-of-plan-entries and replace 15% of arg values with <MASKED>."""
    import json
    try:
        plan = json.loads(plan_json_text)
    except Exception:
        return plan_json_text
    if not isinstance(plan, list):
        return plan_json_text
    rng = xorshift32(int(seed) & 0xFFFFFFFF or 1)
    out = []
    for entry in plan:
        if not isinstance(entry, dict):
            out.append(entry)
            continue
        args = dict(entry.get("args") or {})
        for k in list(args.keys()):
            if rng() < drop_prob:
                args[k] = "<MASKED>"
        new_entry = {**entry, "args": args}
        out.append(new_entry)
    return json.dumps(out, ensure_ascii=False)


# ── Convenience: merge PLAN-masked content into the raw controller text ───
# When constructing training samples, we often want to feed the MASKED plan
# to the model instead of the original — forces it to fill in masked slots
# from context rather than memorising.
def splice_masked_plan(text: str, masked_plan_json: str) -> str:
    if not masked_plan_json:
        return text
    return _BLOCK_RE["PLAN"].sub(
        lambda m: f"<PLAN>{masked_plan_json}</PLAN>", text, count=1
    )


__all__ = [
    "TOKEN_WEIGHTS",
    "PLAN_MASK_PROB",
    "BlockSpan",
    "find_block_spans",
    "char_to_weight_array",
    "token_weights_for",
    "apply_plan_mask",
    "splice_masked_plan",
    "xorshift32",
]
