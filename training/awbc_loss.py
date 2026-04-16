# ═══════════════════════════════════════════════════════════════════════════
# KURO::TRAINING — Advantage-Weighted Behavioral Cloning loss (Spec §6)
# ═══════════════════════════════════════════════════════════════════════════
#
#   L = 𝔼[ CE(π(x_t, z_t), a_t) · w_t  +  λ₁·Huber(ΔV_pred, ΔV_actual) ]
#       + β · KL( π || π_base )
#
#   where
#     w_t        comes from advantage.Stage G (per-sample scalar)
#     token-w    comes from token_weights.py (per-token multiplier)
#     ΔV_pred    parsed from controller DELTA block at log time (scalar per sample)
#     ΔV_actual  V_{t+1} − V_t (scalar per sample)
#     π_base     the frozen base model (QLoRA means this is the dequantised
#                reference; we compute KL on the anchored subset of tokens)
#
# This module is framework-agnostic over the sample batch shape. It expects:
#   input_ids        [B, L]
#   attention_mask   [B, L]
#   labels           [B, L]   (−100 at non-loss positions)
#   token_weights    [B, L]   (per-token block weights, float)
#   sample_weights   [B]      (w_t from Stage G)
#   delta_pred       [B]      (logged; optional, skipped if absent)
#   delta_actual     [B]      (scalar target)
#
# Integration with HF Trainer: subclass Trainer and override `compute_loss`
# to call `awbc_loss(...)` — see `train.py`.
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import torch
import torch.nn.functional as F


@dataclass
class AWBCLossOutput:
    loss: torch.Tensor
    ce: torch.Tensor
    huber: torch.Tensor
    kl: torch.Tensor
    token_count: int


def _weighted_ce(
    logits: torch.Tensor,        # [B, L, V]
    labels: torch.Tensor,        # [B, L]
    token_weights: torch.Tensor, # [B, L]  float
    sample_weights: torch.Tensor,# [B]     float
    ignore_index: int = -100,
) -> tuple[torch.Tensor, int]:
    """Per-token CE, weighted by token-weight × sample-weight, then mean-pooled."""
    # Shift so that tokens predict next tokens (causal LM convention)
    shift_logits = logits[:, :-1, :].contiguous()
    shift_labels = labels[:, 1:].contiguous()
    shift_tw     = token_weights[:, 1:].contiguous()

    B, Lm1, V = shift_logits.shape
    flat_logits = shift_logits.view(-1, V)
    flat_labels = shift_labels.view(-1)
    flat_tw     = shift_tw.view(-1)

    # Per-token loss (no reduction)
    loss_per_tok = F.cross_entropy(
        flat_logits, flat_labels,
        ignore_index=ignore_index, reduction="none"
    )                                       # [B*Lm1]

    # Mask tokens where label was ignored
    valid = (flat_labels != ignore_index).float()  # [B*Lm1]
    loss_per_tok = loss_per_tok * valid

    # Multiply by token-weight and sample-weight
    sw = sample_weights.view(B, 1).expand(B, Lm1).contiguous().view(-1)  # [B*Lm1]
    weighted = loss_per_tok * flat_tw * sw

    tok_count = int(valid.sum().item())
    denom = max(tok_count, 1)
    return weighted.sum() / denom, tok_count


def _delta_huber(
    delta_pred_head: Optional[torch.Tensor],  # [B]  model's regression head output
    delta_actual:    torch.Tensor,             # [B]
    delta_huber:     float = 1.0,
) -> torch.Tensor:
    """Huber loss on ΔV regression. Returns 0 if no head is attached."""
    if delta_pred_head is None:
        return torch.zeros((), device=delta_actual.device, dtype=delta_actual.dtype)
    return F.huber_loss(delta_pred_head, delta_actual, delta=delta_huber)


def _kl_vs_base(
    current_logits: torch.Tensor,   # [B, L, V]
    base_logits:    Optional[torch.Tensor],  # [B, L, V]
    labels:         torch.Tensor,   # [B, L]
    sample_fraction: float,
    ignore_index:   int = -100,
) -> torch.Tensor:
    """KL(current || base), averaged over loss-active tokens of a sampled subset
    of the batch (sample_fraction controls memory cost).
    """
    if base_logits is None:
        return torch.zeros((), device=current_logits.device, dtype=current_logits.dtype)

    B = current_logits.size(0)
    if sample_fraction >= 1.0:
        sel = torch.arange(B, device=current_logits.device)
    else:
        k = max(1, int(B * sample_fraction))
        sel = torch.randperm(B, device=current_logits.device)[:k]

    cur = current_logits[sel][:, :-1, :]
    bse = base_logits[sel][:, :-1, :]
    lbl = labels[sel][:, 1:]

    # log-softmax both, KL per token
    cur_lp = F.log_softmax(cur, dim=-1)
    bse_lp = F.log_softmax(bse, dim=-1)
    cur_p  = cur_lp.exp()

    kl_per_tok = (cur_p * (cur_lp - bse_lp)).sum(dim=-1)   # [B', L-1]
    mask = (lbl != ignore_index).float()
    denom = mask.sum().clamp(min=1.0)
    return (kl_per_tok * mask).sum() / denom


def awbc_loss(
    *,
    logits: torch.Tensor,
    labels: torch.Tensor,
    token_weights: torch.Tensor,
    sample_weights: torch.Tensor,
    delta_actual: torch.Tensor,
    delta_pred_head: Optional[torch.Tensor] = None,
    base_logits: Optional[torch.Tensor] = None,
    # Coefficients
    lambda_huber: float = 0.1,
    beta_kl: float = 0.01,
    kl_sample_fraction: float = 0.25,
    huber_delta: float = 1.0,
) -> AWBCLossOutput:
    """Top-level AWBC loss composing CE·w_t + λ₁·Huber + β·KL.

    All arrays are expected to be on the same device as `logits`. The caller
    owns casting to bf16 / fp32 as needed — we operate in whatever dtype the
    tensors arrive in, then return a float32 scalar loss for backward().
    """
    ce, tok = _weighted_ce(
        logits=logits,
        labels=labels,
        token_weights=token_weights,
        sample_weights=sample_weights,
    )
    huber = _delta_huber(delta_pred_head, delta_actual, delta_huber=huber_delta)
    kl    = _kl_vs_base(
        current_logits=logits,
        base_logits=base_logits,
        labels=labels,
        sample_fraction=kl_sample_fraction,
    )

    loss = ce + lambda_huber * huber + beta_kl * kl
    return AWBCLossOutput(loss=loss, ce=ce.detach(), huber=huber.detach(), kl=kl.detach(), token_count=tok)


__all__ = ["awbc_loss", "AWBCLossOutput"]
