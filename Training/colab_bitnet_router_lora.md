# BitNet router LoRA on Google Colab (T4)

This guide trains a **router LoRA** in Python with **transformers**, **peft**, and **trl**, using the same **Llama-3 style** prompt framing as the Otonome Rust backend (`otonome_llm.rs`: `<|begin_of_text|>`, `<|start_header_id|>`, …), then exports **`router-lora.gguf`** via **llama.cpp** `convert_lora_to_gguf.py`.

**Prerequisites**

1. Run locally: `node Training/clean_chat_dataset.mjs --in Training/router_training_data.jsonl --out Training/router_clean.jsonl`
2. Upload **`router_clean.jsonl`** to Colab (Drive or direct upload).

**Colab runtime:** **Runtime → Change runtime type → GPU → T4**.

---

## Cell 1 — Install dependencies

```python
# BitNet needs remote modeling code; trl/peft/transformers from recent wheels.
%pip install -q "transformers>=4.44.0" "accelerate>=0.33.0" "peft>=0.12.0" "trl>=0.12.0" datasets sentencepiece protobuf
```

---

## Cell 2 — Mount Drive (optional) and paths

```python
from google.colab import drive
drive.mount("/content/drive")

# TODO: set to your uploaded cleaned JSONL (HF messages: user + assistant)
CLEAN_JSONL = "/content/drive/MyDrive/router_clean.jsonl"  # or "/content/router_clean.jsonl"

OUTPUT_DIR = "/content/drive/MyDrive/bitnet_router_lora_out"  # adapter + logs
import os
os.makedirs(OUTPUT_DIR, exist_ok=True)
```

---

## Cell 3 — Load cleaned dataset and build **prompt / completion** (Llama-3 headers)

Otonome uses this system block and user fence; **match it in training** so the LoRA aligns with `build_pass1_prompt` in Rust (`otonome_llm.rs`).

TRL **prompt–completion** rows train with **loss on the completion only** when `completion_only_loss=True` (recommended here), so the model learns the bracket line after the fixed assistant header.

```python
import json
import re
from datasets import Dataset

PASS1_SYSTEM_PROMPT = r"""ZZ9-pass1|v=1|out:one_line
Output: '[' then 32 comma-separated ints each in {-1,0,1} then ']'. Nothing else—no apologies, labels, or sentences.

Idx→topic (0..26; 27..31 use 0 unless clearly required):
0:VisionStrategy 1:ProductDev 2:MarketSell 3:SupplyChain 4:ServiceDelivery 5:CustomerSvc 6:HumanCapital 7:IT 8:Finance 9:Assets 10:RiskCompliance 11:ExtRelations 12:BizCapabilities 13:Urgency 14:Privacy 15:RiskLevel 16:Sentiment(-1/0/+1) 17:Complexity 18:Knowledge 19:Authority 20:Format 21:Verification 22:Language 23:History 24:Ambiguity 25:Stability 26:Iteration 27..31:reserved"""

ASSISTANT_HEAD = (
    "<|start_header_id|>assistant<|end_header_id|>\n\n"
)


def parse_int_vector(s: str):
    """Parse '[a, b, ...]' into list[int]; tolerates spaces."""
    s = s.strip()
    m = re.match(r"^\[(.*)\]\s*$", s, re.DOTALL)
    if not m:
        raise ValueError(f"assistant is not a bracket list: {s[:80]!r}…")
    inner = m.group(1).strip()
    if not inner:
        return []
    parts = [p.strip() for p in inner.split(",")]
    return [int(p) for p in parts]


def pad_to_32(vals):
    """CSV router used 27 slots; Rust Pass-1 expects 32 ternary ints."""
    if len(vals) > 32:
        raise ValueError(f"expected at most 32 values, got {len(vals)}")
    if len(vals) < 32:
        vals = list(vals) + [0] * (32 - len(vals))
    for i, v in enumerate(vals):
        if v not in (-1, 0, 1):
            raise ValueError(f"index {i}: value {v} not in {{-1,0,1}}")
    return vals


def build_prompt_prefix(user_text: str) -> str:
    """Prefix through assistant header + blank line (same as Rust, without assistant body)."""
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


rows = []
with open(CLEAN_JSONL, "r", encoding="utf-8") as f:
    for lineno, line in enumerate(f, 1):
        line = line.strip()
        if not line:
            continue
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
                # Teach explicit end-of-turn (Llama-3 tokenizer)
                "completion": assistant_line.strip() + "<|eot_id|>",
            }
        )

ds = Dataset.from_list(rows)
print(len(ds), "examples")
print("--- prompt tail ---\n", ds[0]["prompt"][-220:])
print("--- completion ---\n", ds[0]["completion"])
```

---

## Cell 4 — Model, tokenizer, LoRA (r=32, alpha=32)

**Model ID:** `microsoft/BitNet-b1.58-2B-4T` (Hugging Face; if `pip`/hub complains, try the lowercase path shown on the model card).

```python
import os
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model, TaskType

MODEL_ID = "microsoft/BitNet-b1.58-2B-4T"

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    trust_remote_code=True,
    torch_dtype=dtype,
    device_map="auto",
)

lora_r = 32
lora_alpha = 32

peft_cfg = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=lora_r,
    lora_alpha=lora_alpha,
    lora_dropout=0.05,
    bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
)

model = get_peft_model(model, peft_cfg)
model.print_trainable_parameters()

# Training-only: no repetition_penalty (that is a generation knob, not used here).
# If you add eval + generate(), omit repetition_penalty from GenerationConfig.
```

---

## Cell 5 — Train with **trl** `SFTTrainer` (completion-only loss)

With a **`prompt` / `completion`** dataset, TRL computes loss on **completion** tokens when `completion_only_loss=True`. No `repetition_penalty` is involved (that is only for `generate()`).

```python
from trl import SFTTrainer, SFTConfig

args = SFTConfig(
    output_dir=OUTPUT_DIR,
    num_train_epochs=1,
    per_device_train_batch_size=1,
    gradient_accumulation_steps=8,
    learning_rate=2e-4,
    warmup_ratio=0.03,
    logging_steps=10,
    save_steps=200,
    save_total_limit=2,
    bf16=torch.cuda.is_bf16_supported(),
    fp16=not torch.cuda.is_bf16_supported(),
    max_length=4096,
    packing=False,
    completion_only_loss=True,
    report_to="none",
)

# `processing_class` (newer TRL); if you see an error, try `tokenizer=tokenizer` instead.
trainer = SFTTrainer(
    model=model,
    args=args,
    train_dataset=ds,
    processing_class=tokenizer,
)

trainer.train()
trainer.model.save_pretrained(os.path.join(OUTPUT_DIR, "peft_adapter"))
tokenizer.save_pretrained(os.path.join(OUTPUT_DIR, "peft_adapter"))
print("Saved PEFT adapter to", os.path.join(OUTPUT_DIR, "peft_adapter"))
```

Adjust `num_train_epochs`, `learning_rate`, and `max_length` if you hit OOM (try `max_length=2048` or batch 1 / grad_accum 16).

---

## Cell 6 — Clone **llama.cpp** and convert PEFT → **`router-lora.gguf`**

This uses the official script (paths may vary slightly by commit):

```python
%cd /content
!git clone --depth 1 https://github.com/ggerganov/llama.cpp.git

ADAPTER = os.path.join(OUTPUT_DIR, "peft_adapter")
BASE_HF = MODEL_ID
GGUF_OUT = os.path.join(OUTPUT_DIR, "router-lora.gguf")

cmd = (
    f'python /content/llama.cpp/convert_lora_to_gguf.py "{ADAPTER}" '
    f'--base "{BASE_HF}" --outfile "{GGUF_OUT}" --outtype f16'
)
print(cmd)
!{cmd}

import os
assert os.path.isfile(GGUF_OUT), "convert_lora_to_gguf failed — check logs above"
print("GGUF adapter:", GGUF_OUT)
```

**Notes**

- You need a **llama.cpp** revision whose `convert_lora_to_gguf.py` supports your base architecture; if conversion errors on BitNet-specific tensors, try the same **qvac-fabric-llm.cpp** fork you use locally, or update `llama.cpp` to latest and retry.
- Your Rust app loads **`router-lora.gguf`** next to **`ms-2b-4t-pure.gguf`**. The adapter tensors must match the **GGUF base** layout; if online conversion mismatches your quantized base, convert using a **local llama.cpp** tree pinned to the same commit as Otonome’s QVAC build, with `--base` pointing at the **HF** folder that matches that GGUF.

---

## Cell 7 — Download

```python
from google.colab import files
files.download(os.path.join(OUTPUT_DIR, "router-lora.gguf"))
```

Copy the file into your repo’s `bitnet-b1.58-2B-4T-gguf/` (or set `OTONOME_ROUTER_LORA_PATH`).

---

### Summary

| Step | Action |
|------|--------|
| Local | `node Training/clean_chat_dataset.mjs` on your JSONL |
| Colab | Build **`prompt`** (Llama-3 headers + **PASS1_SYSTEM_PROMPT** + fenced user + assistant head) and **`completion`** (32-slot bracket + `<|eot_id|>`) |
| Train | **PEFT** LoRA **r=32, α=32** on attention projections; **SFTTrainer** + completion-only collator |
| Export | `convert_lora_to_gguf.py` → **`router-lora.gguf`** |

If anything fails on BitNet (custom `forward`, etc.), paste the **first full traceback** and the **transformers / peft / trl versions** from `%pip show`.
