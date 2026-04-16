# ═══════════════════════════════════════════════════════════════════════════
# KURO::TRAINING — QLoRA 4-bit AWBC trainer for Qwen3.5 35B (Spec §5, §6, §8)
# ═══════════════════════════════════════════════════════════════════════════
#
# Pipeline (from sanitize.py / balance.py output):
#
#   balanced.parquet
#         │
#         ▼ load_dataset(parquet)
#         │
#         ▼ KuroCollator — builds input_ids, labels, token_weights, sample_weight,
#                          delta_pred, delta_actual
#         │
#         ▼ HF Trainer(KuroTrainer) — subclass overriding `compute_loss`
#                                     to call training/awbc_loss.py
#         │
#         ▼ saves LoRA adapter + tokenizer to ${output_dir}
#
# Run:
#   accelerate launch --config_file training/configs/accelerate.yaml \
#       training/train.py --config training/configs/awbc.yaml
#
# This script intentionally keeps model/dataset wiring vanilla-HF so operators
# can swap to a different base model by changing the YAML only.
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import torch
import yaml
from torch.utils.data import Dataset

from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

from training.awbc_loss import awbc_loss
from training.token_weights import (
    splice_masked_plan,
    token_weights_for,
)

IGNORE_INDEX = -100


# ── Config loader ──────────────────────────────────────────────────────────
def _expand(p: str) -> str:
    return os.path.expandvars(os.path.expanduser(p))


def load_cfg(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# ── Dataset ────────────────────────────────────────────────────────────────
# Sampling strategy:
#   input  = a compact state prompt reconstructed from the row
#   target = the controller's structured five-block emission (with PLAN masking
#            applied if plan_masked was logged)
# The prompt tokens get label=−100; only the response contributes to CE.
#
# This keeps training teacher-forced on exactly the output structure the
# inference-time parser in prompts.cjs expects.
class KuroParquetDataset(Dataset):
    def __init__(self, parquet_path: str, tokenizer, max_length: int):
        import pandas as pd
        self.df = pd.read_parquet(parquet_path)
        self.tok = tokenizer
        self.max_length = max_length

        # Pad token is required; Qwen tokenizers ship without one by default.
        if self.tok.pad_token is None:
            self.tok.pad_token = self.tok.eos_token

    def __len__(self) -> int:
        return len(self.df)

    def _build_prompt(self, row) -> str:
        goal = row.get("goal") or ""
        state_summary = row.get("state_block") or ""
        return (
            "You are KURO::CONTROLLER. Respond with exactly five tagged blocks: "
            "STATE, REASONING, PLAN, DELTA, NEXT_STATE.\n\n"
            f"GOAL: {goal}\n"
            f"STATE SUMMARY: {state_summary}\n\n"
            "Emit the five blocks now."
        )

    def _build_target(self, row) -> str:
        # If plan_masked was logged, splice it into the controller text so the
        # model is trained to tolerate/complete masked plan slots.
        controller_text = row.get("controller_text") or ""
        masked = row.get("plan_masked")
        if isinstance(masked, str) and masked and masked != "[]":
            controller_text = splice_masked_plan(controller_text, masked)
        return controller_text.strip()

    def __getitem__(self, idx):
        row = self.df.iloc[idx].to_dict()
        prompt = self._build_prompt(row)
        target = self._build_target(row)

        # Tokenise prompt + target separately so we know where labels begin
        prompt_ids = self.tok(prompt, add_special_tokens=False)["input_ids"]
        target_ids, target_tw = token_weights_for(target, self.tok, max_length=None)

        # Assemble final sequence, clipped to max_length
        max_len = self.max_length
        eos_id = self.tok.eos_token_id
        seq = prompt_ids + target_ids + ([eos_id] if eos_id is not None else [])
        if len(seq) > max_len:
            # Favour the tail — truncate from the prompt side
            overflow = len(seq) - max_len
            prompt_ids = prompt_ids[overflow:]
            seq = prompt_ids + target_ids + ([eos_id] if eos_id is not None else [])

        # Labels: ignore prompt tokens; keep target tokens
        labels = [IGNORE_INDEX] * len(prompt_ids) + target_ids
        if eos_id is not None:
            labels.append(eos_id)

        # Per-token weights
        filler = 0.1
        tw = [filler] * len(prompt_ids) + list(target_tw.astype(np.float32))
        if eos_id is not None:
            tw.append(filler)

        assert len(seq) == len(labels) == len(tw), (
            f"length mismatch seq={len(seq)} labels={len(labels)} tw={len(tw)}"
        )

        return {
            "input_ids":      seq,
            "labels":         labels,
            "token_weights":  tw,
            "sample_weight":  float(row.get("weight") or 1.0),
            "delta_actual":   float(row.get("delta_actual") or 0.0),
            "delta_pred":     float(row.get("delta_pred")   or 0.0),
        }


# ── Collator ──────────────────────────────────────────────────────────────
class KuroCollator:
    def __init__(self, tokenizer):
        self.pad_id = tokenizer.pad_token_id

    def __call__(self, batch):
        max_len = max(len(x["input_ids"]) for x in batch)

        def pad(seq, value, length):
            return seq + [value] * (length - len(seq))

        input_ids = torch.tensor(
            [pad(x["input_ids"], self.pad_id, max_len) for x in batch], dtype=torch.long
        )
        labels = torch.tensor(
            [pad(x["labels"], IGNORE_INDEX, max_len) for x in batch], dtype=torch.long
        )
        token_weights = torch.tensor(
            [pad(x["token_weights"], 0.0, max_len) for x in batch], dtype=torch.float32
        )
        attention_mask = (input_ids != self.pad_id).long()

        sample_weight = torch.tensor([x["sample_weight"] for x in batch], dtype=torch.float32)
        delta_actual  = torch.tensor([x["delta_actual"]  for x in batch], dtype=torch.float32)
        delta_pred    = torch.tensor([x["delta_pred"]    for x in batch], dtype=torch.float32)

        return {
            "input_ids":      input_ids,
            "attention_mask": attention_mask,
            "labels":         labels,
            "token_weights":  token_weights,
            "sample_weight":  sample_weight,
            "delta_actual":   delta_actual,
            "delta_pred":     delta_pred,
        }


# ── Model factory ─────────────────────────────────────────────────────────
def build_model(cfg: dict):
    m = cfg["model"]
    q = cfg["quant"]
    l = cfg["lora"]

    bnb_cfg = BitsAndBytesConfig(
        load_in_4bit=q["load_in_4bit"],
        bnb_4bit_quant_type=q["bnb_4bit_quant_type"],
        bnb_4bit_compute_dtype=getattr(torch, q["bnb_4bit_compute_dtype"]),
        bnb_4bit_use_double_quant=q["bnb_4bit_use_double_quant"],
    )

    tokenizer = AutoTokenizer.from_pretrained(
        m["name"], trust_remote_code=m.get("trust_remote_code", False)
    )

    model = AutoModelForCausalLM.from_pretrained(
        m["name"],
        quantization_config=bnb_cfg,
        torch_dtype=getattr(torch, m.get("torch_dtype", "bfloat16")),
        attn_implementation=m.get("attn_implementation", "eager"),
        trust_remote_code=m.get("trust_remote_code", False),
    )
    model = prepare_model_for_kbit_training(model)

    lora_cfg = LoraConfig(
        r=l["r"],
        lora_alpha=l["alpha"],
        lora_dropout=l["dropout"],
        bias=l["bias"],
        target_modules=l["target_modules"],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()
    return model, tokenizer


# ── Custom Trainer ────────────────────────────────────────────────────────
class KuroTrainer(Trainer):
    """HF Trainer that wires its `compute_loss` hook to `awbc_loss`."""

    def __init__(self, *args, awbc_cfg: dict, **kwargs):
        super().__init__(*args, **kwargs)
        self.awbc_cfg = awbc_cfg

    def compute_loss(self, model, inputs, return_outputs=False, **_):
        labels         = inputs.pop("labels")
        token_weights  = inputs.pop("token_weights")
        sample_weight  = inputs.pop("sample_weight")
        delta_actual   = inputs.pop("delta_actual")
        _delta_pred    = inputs.pop("delta_pred", None)  # logged, informational

        outputs = model(**inputs, use_cache=False)
        logits = outputs.logits

        # KL reference: LoRA-disabled forward pass on the same batch.
        base_logits = None
        if self.awbc_cfg["beta_kl"] > 0:
            with torch.no_grad():
                try:
                    with model.disable_adapter():
                        base_logits = model(**inputs, use_cache=False).logits.detach()
                except Exception:
                    base_logits = None  # non-PEFT path — skip KL

        out = awbc_loss(
            logits=logits,
            labels=labels,
            token_weights=token_weights,
            sample_weights=sample_weight,
            delta_actual=delta_actual,
            delta_pred_head=None,            # head-less variant — CE on DELTA tokens carries the signal
            base_logits=base_logits,
            lambda_huber=self.awbc_cfg["lambda_huber"],
            beta_kl=self.awbc_cfg["beta_kl"],
            kl_sample_fraction=self.awbc_cfg["kl_sample_fraction"],
            huber_delta=self.awbc_cfg["huber_delta"],
        )

        if self.state.global_step % self.args.logging_steps == 0:
            self.log({
                "ce":  float(out.ce.detach().cpu()),
                "huber": float(out.huber.detach().cpu()),
                "kl":  float(out.kl.detach().cpu()),
                "toks_in_loss": out.token_count,
            })

        return (out.loss, outputs) if return_outputs else out.loss


# ── Main ──────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="KURO AWBC trainer.")
    ap.add_argument("--config", default="training/configs/awbc.yaml")
    ap.add_argument("--balanced", default=None,
                    help="Override cfg.data.balanced_out (parquet).")
    args = ap.parse_args()

    cfg = load_cfg(args.config)
    balanced_path = _expand(args.balanced or cfg["data"]["balanced_out"])
    if not os.path.exists(balanced_path):
        print(f"[train] balanced parquet missing: {balanced_path}", file=sys.stderr)
        return 2

    model, tokenizer = build_model(cfg)

    ds = KuroParquetDataset(
        balanced_path, tokenizer,
        max_length=cfg["train"]["max_seq_length"]
    )
    collator = KuroCollator(tokenizer)

    t = cfg["train"]
    targs = TrainingArguments(
        output_dir                  = _expand(t["output_dir"]),
        num_train_epochs            = t["num_train_epochs"],
        per_device_train_batch_size = t["per_device_train_batch_size"],
        gradient_accumulation_steps = t["gradient_accumulation_steps"],
        learning_rate               = t["learning_rate"],
        lr_scheduler_type           = t["lr_scheduler_type"],
        warmup_ratio                = t["warmup_ratio"],
        weight_decay                = t["weight_decay"],
        save_strategy               = t["save_strategy"],
        save_steps                  = t["save_steps"],
        logging_steps               = t["logging_steps"],
        bf16                        = t["bf16"],
        gradient_checkpointing      = t["gradient_checkpointing"],
        seed                        = t["seed"],
        remove_unused_columns       = False,     # our collator needs the extras
        report_to                   = ["tensorboard"],
    )

    trainer = KuroTrainer(
        model=model,
        args=targs,
        train_dataset=ds,
        data_collator=collator,
        awbc_cfg=cfg["loss"],
    )
    trainer.train()
    trainer.save_model(_expand(t["output_dir"]))
    tokenizer.save_pretrained(_expand(t["output_dir"]))

    # Dump a run manifest so promote.py can pick up the latest checkpoint
    manifest = {
        "output_dir": _expand(t["output_dir"]),
        "model": cfg["model"]["name"],
        "samples": len(ds),
        "loss_cfg": cfg["loss"],
        "pipeline_cfg": cfg["pipeline"],
    }
    Path(manifest["output_dir"]).mkdir(parents=True, exist_ok=True)
    with open(os.path.join(manifest["output_dir"], "run_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    print(f"[train] done — {manifest['samples']} samples → {manifest['output_dir']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
