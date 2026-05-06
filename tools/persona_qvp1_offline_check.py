#!/usr/bin/env python3
"""
Offline checks for QVP1 files (stdlib only; no NumPy).

  python tools/persona_qvp1_offline_check.py path/to/plugin.qvp1

Validates header magic/version and payload size. Optionally simulates merge_mode 1
F32 update on synthetic weights (same rule as C++ persona_plugin.cpp).
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path


def clamp_ternary(b: int) -> float:
    if b > 0:
        return 1.0
    if b < 0:
        return -1.0
    return 0.0


def parse_qvp1(data: bytes) -> dict:
    if len(data) < 128:
        raise ValueError("file too small")
    if data[0:4] != b"QVP1":
        raise ValueError("bad magic")
    version, merge_mode, layer, _reserved = struct.unpack_from("<4I", data, 4)
    suffix = data[20:84].split(b"\x00", 1)[0].decode("utf-8", errors="replace")
    delta_scale = struct.unpack_from("<f", data, 84)[0]
    payload_size, = struct.unpack_from("<Q", data, 88)
    payload = data[128:]
    if len(payload) < payload_size:
        raise ValueError("truncated payload")
    return {
        "version": version,
        "merge_mode": merge_mode,
        "layer": layer,
        "tensor_suffix": suffix,
        "delta_scale": delta_scale,
        "payload_size": payload_size,
        "payload": payload[:payload_size],
    }


def simulate_merge_mode1(weights: list[float], plugin: bytes, delta_scale: float) -> list[float]:
    if len(plugin) != len(weights):
        raise ValueError("plugin bytes must match weight count")
    out = weights[:]
    for i, b in enumerate(plugin):
        out[i] += delta_scale * clamp_ternary(b if b <= 127 else b - 256)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("qvp1_path", type=Path)
    ap.add_argument(
        "--simulate-m1",
        action="store_true",
        help="run merge_mode 1 on two synthetic floats (sanity)",
    )
    args = ap.parse_args()
    data = args.qvp1_path.read_bytes()
    meta = parse_qvp1(data)
    print(
        f"OK {args.qvp1_path.name}: version={meta['version']} "
        f"merge_mode={meta['merge_mode']} layer={meta['layer']} "
        f"suffix={meta['tensor_suffix']!r} payload_size={meta['payload_size']}"
    )
    if args.simulate_m1:
        if meta["merge_mode"] != 1:
            print("skip --simulate-m1: merge_mode != 1", file=sys.stderr)
            return
        w = [1.0, 2.0]
        if meta["payload_size"] != 2:
            print("skip --simulate-m1: expected payload_size 2 for toy sim", file=sys.stderr)
            return
        plug = meta["payload"]
        w2 = simulate_merge_mode1(w, plug, meta["delta_scale"])
        print("simulate m1:", w, "->", w2)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)
