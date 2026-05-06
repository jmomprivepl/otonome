#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""
DualPassQVACEngine — two-pass inference with Hugging Face + PEFT (optional placeholders)

================================================================================
INSTALL (run once in your venv, from repo root or anywhere)
================================================================================

  pip install -U torch transformers peft accelerate safetensors sentencepiece

Optional 4-bit quantization (NVIDIA GPU, extra VRAM savings — not all models support it):

  pip install bitsandbytes

Optional: same CPU-only torch as router training:

  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install transformers peft accelerate safetensors sentencepiece

================================================================================
PASTE YOUR PATHS / MODEL ID HERE
================================================================================
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import IntEnum
from pathlib import Path
from typing import Any, Literal, Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# >>> EDIT THESE THREE LINES FOR YOUR MACHINE <<<
# ---------------------------------------------------------------------------

# Hugging Face hub id OR a local folder with config.json + weights (same as train_router_local.py).
BASE_MODEL_ID_OR_PATH: str = "microsoft/BitNet-b1.58-2B-4T"

# Folders each containing adapter_config.json + adapter_model.safetensors (or .bin).
QVAC_LORA_PATH: str = r"C:\path\to\your\qvac_lora_adapter"
LOTA_QAF_PATH: str = r"C:\path\to\your\lota_qaf_adapter"

# Logical adapter names used by PEFT `set_adapter(...)`. First load uses ADAPTER_NAME_QVAC,
# second load uses ADAPTER_NAME_LOTA. Change only if you rename when loading.
ADAPTER_NAME_QVAC: str = "qvac_lora"
ADAPTER_NAME_LOTA: str = "lota_qaf"

# Set True to try bitsandbytes 4-bit on GPU (falls back if import or model fails).
USE_4BIT_QUANTIZATION: bool = False

# Default generation length (override per call via kwargs: max_new_tokens=...).
DEFAULT_MAX_NEW_TOKENS: int = 128

# ---------------------------------------------------------------------------
# Repo / Otonome context (unchanged intent)
# ---------------------------------------------------------------------------

"""
Production Otonome still uses Rust + llama.cpp (`otonome_llm.rs`, `qvac_pass2.rs`).
This Python module is for HF experiments or a future sidecar. Tauri does not import it.

Pass 1 (here):  PEFT adapter ADAPTER_NAME_QVAC active → generate.
Pass 2 (here):  PEFT adapter ADAPTER_NAME_LOTA active → generate.
The inactive adapter is not applied (PEFT switches weights via set_adapter).
"""

# ---------------------------------------------------------------------------
# Pass id
# ---------------------------------------------------------------------------


class PassId(IntEnum):
    PASS1 = 1
    PASS2 = 2


# ---------------------------------------------------------------------------
# Protocols (unchanged contracts)
# ---------------------------------------------------------------------------


@runtime_checkable
class QVACEngine(Protocol):
    def forward(self, x: Any, *, pass_id: PassId, **kwargs: Any) -> Any:
        ...


@runtime_checkable
class QVACLora(Protocol):
    def set_enabled(self, enabled: bool) -> None:
        ...

    def is_enabled(self) -> bool:
        ...

    def apply(self, x: Any, *, pass_id: PassId) -> Any:
        ...


@runtime_checkable
class LoTAQAFAdapter(Protocol):
    def set_enabled(self, enabled: bool) -> None:
        ...

    def is_enabled(self) -> bool:
        ...

    def apply(self, x: Any, *, pass_id: PassId) -> Any:
        ...


# ---------------------------------------------------------------------------
# PEFT “slots” — identity apply(); real switching is PeftModel.set_adapter (see controller)
# ---------------------------------------------------------------------------


@dataclass
class PeftSlotShim:
    """Marks which logical path is active; `apply` is identity (weights already switched on PeftModel)."""

    label: str
    _enabled: bool = False

    def set_enabled(self, enabled: bool) -> None:
        self._enabled = bool(enabled)

    def is_enabled(self) -> bool:
        return self._enabled

    def apply(self, x: Any, *, pass_id: PassId) -> Any:
        return x


# ---------------------------------------------------------------------------
# HF engine — text in, text out (uses whatever adapter is already selected on the model)
# ---------------------------------------------------------------------------


class HFQVACEngine:
    """
    Wraps one shared `PeftModel` + tokenizer. Call `DualPassQVACEngine` first so
    `set_adapter` runs before `forward`.
    """

    def __init__(
        self,
        model: Any,
        tokenizer: Any,
        *,
        default_max_new_tokens: int = DEFAULT_MAX_NEW_TOKENS,
    ) -> None:
        self._model = model
        self._tokenizer = tokenizer
        self._default_max_new_tokens = default_max_new_tokens

    def forward(self, x: Any, *, pass_id: PassId, **kwargs: Any) -> str:
        prompt = x if isinstance(x, str) else str(x)
        max_new = int(kwargs.pop("max_new_tokens", self._default_max_new_tokens))
        temperature = float(kwargs.pop("temperature", 0.0))
        do_sample = bool(kwargs.pop("do_sample", temperature > 0.0))

        import torch

        self._model.eval()
        inputs = self._tokenizer(prompt, return_tensors="pt")
        # Move inputs to same device as model parameters
        device = next(self._model.parameters()).device
        inputs = {k: v.to(device) for k, v in inputs.items()}

        gen_kwargs: dict[str, Any] = dict(
            max_new_tokens=max_new,
            do_sample=do_sample,
            pad_token_id=self._tokenizer.pad_token_id,
            eos_token_id=self._tokenizer.eos_token_id,
        )
        if do_sample:
            gen_kwargs["temperature"] = temperature
        gen_kwargs.update(kwargs)  # allow advanced users to pass extra generate() flags

        with torch.inference_mode():
            out = self._model.generate(**inputs, **gen_kwargs)

        # Decode only the new tokens (after the prompt)
        prompt_len = inputs["input_ids"].shape[1]
        new_tokens = out[0, prompt_len:]
        text = self._tokenizer.decode(new_tokens, skip_special_tokens=True)
        return text.strip()


# ---------------------------------------------------------------------------
# Loader — one base model, two adapters in memory, named for set_adapter
# ---------------------------------------------------------------------------


def load_peft_dual_pass_stack(
    base_model_id_or_path: str | None = None,
    qvac_lora_path: str | Path | None = None,
    lota_qaf_path: str | Path | None = None,
    *,
    adapter_qvac: str | None = None,
    adapter_lota: str | None = None,
    use_4bit: bool | None = None,
    trust_remote_code: bool = True,
) -> tuple[Any, Any]:
    """
    Load `AutoModelForCausalLM` once, attach two PEFT adapters with fixed names, return (peft_model, tokenizer).

    Raises FileNotFoundError / RuntimeError if paths are missing or peft/transformers not installed.
    """
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    from peft import PeftModel

    base = base_model_id_or_path or BASE_MODEL_ID_OR_PATH
    qvac_p = Path(qvac_lora_path or QVAC_LORA_PATH)
    lota_p = Path(lota_qaf_path or LOTA_QAF_PATH)
    name_q = adapter_qvac or ADAPTER_NAME_QVAC
    name_l = adapter_lota or ADAPTER_NAME_LOTA
    want_4bit = USE_4BIT_QUANTIZATION if use_4bit is None else use_4bit

    if not qvac_p.is_dir():
        raise FileNotFoundError(f"QVAC LoRA folder not found: {qvac_p.resolve()}")
    if not lota_p.is_dir():
        raise FileNotFoundError(f"LoTA-QAF adapter folder not found: {lota_p.resolve()}")

    tokenizer = AutoTokenizer.from_pretrained(base, trust_remote_code=trust_remote_code)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model_kwargs: dict[str, Any] = dict(trust_remote_code=trust_remote_code)

    if want_4bit and torch.cuda.is_available():
        try:
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
            )
            model_kwargs["quantization_config"] = bnb_config
            model_kwargs["device_map"] = "auto"
        except Exception as e:
            raise RuntimeError(
                "USE_4BIT_QUANTIZATION is True but 4-bit setup failed "
                "(install bitsandbytes and use a CUDA GPU). "
                f"Original error: {e}",
            ) from e
    else:
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        model_kwargs["torch_dtype"] = dtype
        if torch.cuda.is_available():
            model_kwargs["device_map"] = "auto"
        else:
            model_kwargs["device_map"] = None

    base_model = AutoModelForCausalLM.from_pretrained(base, **model_kwargs)
    if model_kwargs.get("device_map") is None:
        base_model = base_model.to("cpu")

    # First adapter: becomes active name `name_q`
    peft_model = PeftModel.from_pretrained(
        base_model,
        str(qvac_p),
        adapter_name=name_q,
    )
    # Second adapter on the same wrapper (VRAM-efficient: one base, two LoRA heads)
    peft_model.load_adapter(str(lota_p), adapter_name=name_l)

    # Start in a known state (Pass 1 adapter)
    peft_model.set_adapter(name_q)

    return peft_model, tokenizer


def build_hf_dual_pass_engine(
    base_model_id_or_path: str | None = None,
    qvac_lora_path: str | Path | None = None,
    lota_qaf_path: str | Path | None = None,
    *,
    adapter_qvac: str | None = None,
    adapter_lota: str | None = None,
    use_4bit: bool | None = None,
    default_max_new_tokens: int = DEFAULT_MAX_NEW_TOKENS,
) -> DualPassQVACEngine:
    """
    End-to-end: load stack + build `DualPassQVACEngine` wired for `set_adapter` switching.
    """
    peft_model, tokenizer = load_peft_dual_pass_stack(
        base_model_id_or_path=base_model_id_or_path,
        qvac_lora_path=qvac_lora_path,
        lota_qaf_path=lota_qaf_path,
        adapter_qvac=adapter_qvac,
        adapter_lota=adapter_lota,
        use_4bit=use_4bit,
    )
    engine = HFQVACEngine(peft_model, tokenizer, default_max_new_tokens=default_max_new_tokens)
    shim_q = PeftSlotShim("qvac")
    shim_l = PeftSlotShim("lota")
    return DualPassQVACEngine(
        qvac_engine=engine,
        qvac_lora=shim_q,
        lota_qaf_adapter=shim_l,
        peft_model=peft_model,
        adapter_name_pass1=adapter_qvac or ADAPTER_NAME_QVAC,
        adapter_name_pass2=adapter_lota or ADAPTER_NAME_LOTA,
    )


# ---------------------------------------------------------------------------
# Placeholders (no torch) — for quick sanity checks without weights
# ---------------------------------------------------------------------------


@dataclass
class PlaceholderQVACEngine:
    name: str = "QVACEngine"

    def forward(self, x: Any, *, pass_id: PassId, **kwargs: Any) -> Any:
        _ = kwargs
        text = x if isinstance(x, str) else str(x)
        return f"[{self.name}|pass{pass_id.value}]{text}"


@dataclass
class PlaceholderQVACLora:
    _enabled: bool = False

    def set_enabled(self, enabled: bool) -> None:
        self._enabled = bool(enabled)

    def is_enabled(self) -> bool:
        return self._enabled

    def apply(self, x: Any, *, pass_id: PassId) -> Any:
        if not self._enabled:
            return x
        text = x if isinstance(x, str) else str(x)
        return f"[QVACLora|pass{pass_id.value}]{text}"


@dataclass
class PlaceholderLoTAQAFAdapter:
    _enabled: bool = False

    def set_enabled(self, enabled: bool) -> None:
        self._enabled = bool(enabled)

    def is_enabled(self) -> bool:
        return self._enabled

    def apply(self, x: Any, *, pass_id: PassId) -> Any:
        if not self._enabled:
            return x
        text = x if isinstance(x, str) else str(x)
        return f"[LoTAQAF|pass{pass_id.value}]{text}"


# ---------------------------------------------------------------------------
# Controller — strict Pass 1 / Pass 2 + Hugging Face set_adapter traffic control
# ---------------------------------------------------------------------------


class DualPassQVACEngine:
    """
    Pass 1: `set_adapter(adapter_name_pass1)` then LoRA shim ON, LoTA OFF → engine.
    Pass 2: `set_adapter(adapter_name_pass2)` then LoTA ON, LoRA OFF → engine.

    When `peft_model` is provided, `_configure_adapters` calls `peft_model.set_adapter(...)`
    so only one adapter’s weights participate in `generate`.
    """

    def __init__(
        self,
        qvac_engine: QVACEngine,
        qvac_lora: QVACLora,
        lota_qaf_adapter: LoTAQAFAdapter,
        *,
        peft_model: Any | None = None,
        adapter_name_pass1: str = ADAPTER_NAME_QVAC,
        adapter_name_pass2: str = ADAPTER_NAME_LOTA,
    ) -> None:
        self._engine = qvac_engine
        self._lora = qvac_lora
        self._lota = lota_qaf_adapter
        self._peft = peft_model
        self._adapter_name_pass1 = adapter_name_pass1
        self._adapter_name_pass2 = adapter_name_pass2
        self._last_pass: PassId | None = None

    def _configure_adapters(self, pass_id: PassId) -> None:
        """Hard switch flags + PEFT `set_adapter` when a shared PeftModel is wired."""
        if pass_id == PassId.PASS1:
            self._lora.set_enabled(True)
            self._lota.set_enabled(False)
            adapter_name = self._adapter_name_pass1
        else:
            self._lora.set_enabled(False)
            self._lota.set_enabled(True)
            adapter_name = self._adapter_name_pass2

        if self._peft is not None:
            # Hugging Face PEFT: only one adapter active at a time (for this use case)
            self._peft.set_adapter(adapter_name)

        if pass_id == PassId.PASS1:
            if self._lota.is_enabled():
                raise RuntimeError("Pass 1: LoTA-QAF must be disabled")
            if not self._lora.is_enabled():
                raise RuntimeError("Pass 1: QVAC LoRA must be enabled")
        else:
            if self._lora.is_enabled():
                raise RuntimeError("Pass 2: QVAC LoRA must be disabled")
            if not self._lota.is_enabled():
                raise RuntimeError("Pass 2: LoTA-QAF must be enabled")

    def run_pass_1(self, prompt: str, **kwargs: Any) -> Any:
        self._configure_adapters(PassId.PASS1)
        self._last_pass = PassId.PASS1
        x = self._lora.apply(prompt, pass_id=PassId.PASS1)
        return self._engine.forward(x, pass_id=PassId.PASS1, **kwargs)

    def run_pass_2(self, prompt: str, **kwargs: Any) -> Any:
        self._configure_adapters(PassId.PASS2)
        self._last_pass = PassId.PASS2
        x = self._lota.apply(prompt, pass_id=PassId.PASS2)
        return self._engine.forward(x, pass_id=PassId.PASS2, **kwargs)

    def forward(self, prompt: str, pass_number: Literal[1, 2], **kwargs: Any) -> Any:
        if pass_number == 1:
            return self.run_pass_1(prompt, **kwargs)
        if pass_number == 2:
            return self.run_pass_2(prompt, **kwargs)
        raise ValueError("pass_number must be 1 or 2")

    @property
    def last_pass(self) -> PassId | None:
        return self._last_pass

    @property
    def peft_model(self) -> Any | None:
        """Direct access for debugging or saving."""
        return self._peft


# ---------------------------------------------------------------------------
# Demos
# ---------------------------------------------------------------------------


def _demo_placeholder() -> None:
    engine = PlaceholderQVACEngine()
    lora = PlaceholderQVACLora()
    lota = PlaceholderLoTAQAFAdapter()
    dual = DualPassQVACEngine(qvac_engine=engine, qvac_lora=lora, lota_qaf_adapter=lota)
    print("--- Placeholder demo (no GPU / no weights) ---")
    print("Pass 1:", dual.run_pass_1("Hello"))
    print("Pass 2:", dual.run_pass_2("World"))


def _demo_hf_if_paths_exist() -> None:
    qvac_ok = Path(QVAC_LORA_PATH).is_dir() and (Path(QVAC_LORA_PATH) / "adapter_config.json").is_file()
    lota_ok = Path(LOTA_QAF_PATH).is_dir() and (Path(LOTA_QAF_PATH) / "adapter_config.json").is_file()
    if not (qvac_ok and lota_ok):
        print(
            "\nSkipping HF demo: set QVAC_LORA_PATH and LOTA_QAF_PATH at the top of this file "
            "to folders containing adapter_config.json (or export DUALPASS_FORCE_HF=1 to try anyway)."
        )
        return
    if os.environ.get("DUALPASS_FORCE_HF", "").lower() not in ("1", "true", "yes"):
        if r"C:\path\to" in QVAC_LORA_PATH or r"C:\path\to" in LOTA_QAF_PATH:
            print("\nSkipping HF demo: default placeholder paths are still set.")
            return

    print("\n--- HF + PEFT demo (loads model; may take a while) ---")
    dual = build_hf_dual_pass_engine()
    p1 = "Say hello in one short sentence.\nAssistant:"
    print("Pass 1 (qvac adapter):", dual.run_pass_1(p1, max_new_tokens=48)[:500])
    p2 = "Say goodbye in one short sentence.\nAssistant:"
    print("Pass 2 (lota adapter):", dual.run_pass_2(p2, max_new_tokens=48)[:500])


if __name__ == "__main__":
    _demo_placeholder()
    try:
        _demo_hf_if_paths_exist()
    except Exception as e:
        print("\nHF demo error:", e)
