# Local router LoRA training (Windows, CPU)

This pipeline trains the router adapter with **PyTorch + PEFT + TRL** on **CPU** (system RAM), then converts the adapter to **`router-lora.gguf`** using the **qvac-fabric-llm.cpp** `convert_lora_to_gguf.py` script (same family as Otonome’s QVAC build).

**Prerequisites**

- Python **3.10+** on `PATH`.
- Clean dataset: `Training/router_clean.jsonl` (HF `messages` with `user` / `assistant`). Create it with:

```powershell
Set-Location c:\Otonome
node Training\clean_chat_dataset.mjs --in Training\router_training_data.jsonl --out Training\router_clean.jsonl
```

---

## 1. Create a virtual environment

From the repo root (`c:\Otonome`):

```powershell
Set-Location c:\Otonome
python -m venv .venv-router
```

Activate it (PowerShell):

```powershell
.\.venv-router\Scripts\Activate.ps1
```

If execution policy blocks activation:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 2. Install dependencies

Use the **CPU** PyTorch index so pip does not install a CUDA-only build that might still touch the MX110:

```powershell
pip install -U pip
pip install -r Training\requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

---

## 3. Run training (CPU only)

Force no visible CUDA devices for this shell session, then start training:

```powershell
$env:CUDA_VISIBLE_DEVICES = ""
$env:HIP_VISIBLE_DEVICES = "-1"
python Training\train_router_local.py
```

Optional flags:

```powershell
python Training\train_router_local.py --epochs 2 --lr 1e-4 --jsonl Training\router_clean.jsonl --output-dir Training\local_lora_output
```

Outputs:

- **LoRA weights** (what you need for conversion): `Training\local_lora_output\` (`adapter_config.json`, `adapter_model.safetensors`, tokenizer files).
- **Trainer state**: `Training\local_lora_output\trainer_checkpoints\`.

`ms-2b-4t-pure.gguf` is **not** a Hugging Face checkpoint; training always uses the HF id **`microsoft/BitNet-b1.58-2B-4T`** (override with `--model-id` if your mirror differs).

---

## 4. Convert LoRA → `router-lora.gguf`

Run **from** the `qvac-fabric-llm.cpp` directory so local `gguf-py` and `convert_hf_to_gguf` imports resolve. Use the **same** venv as training.

Adapter path = folder that contains `adapter_model.safetensors` (here, `Training\local_lora_output`).

```powershell
Set-Location c:\Otonome\qvac-fabric-llm.cpp
..\.venv-router\Scripts\python.exe convert_lora_to_gguf.py `
  ..\Training\local_lora_output `
  --outfile ..\bitnet-b1.58-2B-4T-gguf\router-lora.gguf `
  --outtype f16 `
  --base-model-id microsoft/BitNet-b1.58-2B-4T
```

If the script errors on missing Python deps, install the converter stack from the repo (example):

```powershell
pip install -r requirements\requirements-convert_hf_to_gguf.txt
```

(re-run from `qvac-fabric-llm.cpp` after any new installs.)

Copy **`router-lora.gguf`** next to **`ms-2b-4t-pure.gguf`** under `bitnet-b1.58-2B-4T-gguf\`, or set `OTONOME_ROUTER_LORA_PATH` in your app.

---

## 5. Deactivate the venv

```powershell
deactivate
```
