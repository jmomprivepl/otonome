#!/usr/bin/env python3
"""
Train router LoRA on CPU (BitNet HF) — avoids llama.cpp BitNet gradient limits and small dGPU VRAM.

Uses the same Llama-3 style prompt framing as `src-tauri/src/otonome_llm.rs` (Pass 1).
Default dataset: Training/router_clean.jsonl (HF `messages`: user + assistant bracket vector).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# Hide CUDA devices before torch is imported (e.g. MX110 with 2GB VRAM).
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("HIP_VISIBLE_DEVICES", "-1")

import torch  # noqa: E402
from datasets import Dataset  # noqa: E402
from peft import LoraConfig, TaskType, get_peft_model  # noqa: E402
from transformers import AutoModelForCausalLM, AutoTokenizer, set_seed  # noqa: E402
from trl import SFTConfig, SFTTrainer  # noqa: E402

TRAINING_DIR = Path(__file__).resolve().parent
REPO_ROOT = TRAINING_DIR.parent

PASS1_SYSTEM_PROMPT = r"""ZZ9-pass1|v=1|out:one_line
Output: '[' then 32 comma-separated ints each in {-1,0,1} then ']'. Nothing else—no apologies, labels, or sentences.

Idx→topic (0..26; 27..31 use 0 unless clearly required):
0:VisionStrategy 1:ProductDev 2:MarketSell 3:SupplyChain 4:ServiceDelivery 5:CustomerSvc 6:HumanCapital 7:IT 8:Finance 9:Assets 10:RiskCompliance 11:ExtRelations 12:BizCapabilities 13:Urgency 14:Privacy 15:RiskLevel 16:Sentiment(-1/0/+1) 17:Complexity 18:Knowledge 19:Authority 20:Format 21:Verification 22:Language 23:History 24:Ambiguity 25:Stability 26:Iteration 27..31:reserved"""

ASSISTANT_HEAD = (
    "<|start_header_id|>assistant<|end_header_id|>\n\n"
)


def parse_int_vector(s: str) -> list[int]:
    s = s.strip()
    m = re.match(r"^\[(.*)\]\s*$", s, re.DOTALL)
    if not m:
        raise ValueError(f"assistant is not a bracket list: {s[:80]!r}")
    inner = m.group(1).strip()
    if not inner:
        return []
    parts = [p.strip() for p in inner.split(",")]
    return [int(p) for p in parts]


def pad_to_32(vals: list[int]) -> list[int]:
    if len(vals) > 32:
        raise ValueError(f"expected at most 32 values, got {len(vals)}")
    if len(vals) < 32:
        vals = list(vals) + [0] * (32 - len(vals))
    for i, v in enumerate(vals):
        if v not in (-1, 0, 1):
            raise ValueError(f"index {i}: value {v} not in {{-1,0,1}}")
    return vals


def build_prompt_prefix(user_text: str) -> str:
    user_block = (
        f"---MSG---\n{user_text.strip()}\n---END---\nROUTING_VECTOR_LINE_ONLY"
    )
    return (
        "<|begin_of_text|>"
        "<|start_header_id|>system<|end_header_id|>\n\n"
        f"{PASS1_SYSTEM_PROMPT}<|eot_id|>"
        "<|start_header_id|>user<|end_header_id|>\n\n"
        f"{user_block}<|eot_id|>"
        + ASSISTANT_HEAD
    )


def load_jsonl_dataset(jsonl_path: Path) -> Dataset:
    rows: list[dict[str, str]] = []
    with jsonl_path.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                msgs = obj["messages"]
                user = next(m["content"] for m in msgs if m["role"] == "user")
                asst = next(m["content"] for m in msgs if m["role"] == "assistant")
                vec = parse_int_vector(asst)
                vec32 = pad_to_32(vec)
                assistant_line = "[" + ", ".join(str(x) for x in vec32) + "]"
                rows.append(
                    {
                        "prompt": build_prompt_prefix(user),
                        "completion": assistant_line.strip() + "<|eot_id|>",
                    }
                )
            except (StopIteration, KeyError, ValueError, json.JSONDecodeError) as e:
                raise RuntimeError(f"{jsonl_path}:{lineno}: {e}") from e
    if not rows:
        raise RuntimeError(f"No examples loaded from {jsonl_path}")
    return Dataset.from_list(rows)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train router LoRA (CPU, BitNet HF)")
    p.add_argument(
        "--model-id",
        default="microsoft/BitNet-b1.58-2B-4T",
        help="Hugging Face model id (GGUF ms-2b-4t-pure is not loadable here).",
    )
    p.add_argument(
        "--jsonl",
        type=Path,
        default=TRAINING_DIR / "router_clean.jsonl",
        help="Cleaned HF messages JSONL",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        default=TRAINING_DIR / "local_lora_output",
        help="Final LoRA adapter + trainer checkpoints",
    )
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--epochs", type=float, default=1.0)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--grad-accum", type=int, default=8)
    p.add_argument("--max-length", type=int, default=4096)
    p.add_argument("--logging-steps", type=int, default=10)
    p.add_argument("--save-steps", type=int, default=200)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    jsonl_path = args.jsonl if args.jsonl.is_absolute() else (REPO_ROOT / args.jsonl).resolve()
    out_dir = (
        args.output_dir
        if args.output_dir.is_absolute()
        else (REPO_ROOT / args.output_dir).resolve()
    )
    ckpt_dir = out_dir / "trainer_checkpoints"
    out_dir.mkdir(parents=True, exist_ok=True)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    if not jsonl_path.is_file():
        print(f"Missing dataset: {jsonl_path}", file=sys.stderr)
        print("Create it with: node Training/clean_chat_dataset.mjs ...", file=sys.stderr)
        return 1

    set_seed(args.seed)

    if torch.cuda.is_available():
        print(
            "Warning: torch.cuda.is_available() is True; CUDA_VISIBLE_DEVICES may not be empty. "
            "Training still uses device_map=cpu.",
            file=sys.stderr,
        )

    print("Loading dataset…")
    ds = load_jsonl_dataset(jsonl_path)
    print(f"  examples: {len(ds)}")

    print(f"Loading tokenizer + model {args.model_id!r} on CPU…")
    tokenizer = AutoTokenizer.from_pretrained(args.model_id, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model_id,
        trust_remote_code=True,
        torch_dtype=torch.float32,
        device_map={"": "cpu"},
        low_cpu_mem_usage=True,
    )
    model.config.use_cache = False
    try:
        model.gradient_checkpointing_enable()
    except Exception:
        pass

    peft_cfg = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=32,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    model = get_peft_model(model, peft_cfg)
    model.print_trainable_parameters()

    sft_args = SFTConfig(
        output_dir=str(ckpt_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        warmup_ratio=0.03,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        save_total_limit=2,
        completion_only_loss=True,
        max_length=args.max_length,
        packing=False,
        fp16=False,
        bf16=False,
        report_to="none",
        gradient_checkpointing=True,
    )

    try:
        trainer = SFTTrainer(
            model=model,
            args=sft_args,
            train_dataset=ds,
            processing_class=tokenizer,
        )
    except TypeError:
        # Older trl used `tokenizer=`.
        trainer = SFTTrainer(
            model=model,
            args=sft_args,
            train_dataset=ds,
            tokenizer=tokenizer,
        )

    print("Training…")
    trainer.train()

    print(f"Saving LoRA adapter to {out_dir} …")
    trainer.model.save_pretrained(str(out_dir))
    tokenizer.save_pretrained(str(out_dir))
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
