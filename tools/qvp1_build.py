#!/usr/bin/env python3
"""
Build a QVP1 persona plugin (see qvac-fabric-llm.cpp/docs/persona-plugin-format.md).

Example (mode 0, payload must match ggml_nbytes of the target tensor at runtime):
  python tools/qvp1_build.py --output personas/sop_engineer.qvp1 --payload-size 4194304 --layer 0

Mode 1 (F32 ternary delta): payload is one int8 per element; use --merge-mode 1 --nelements N.
"""
from __future__ import annotations

import argparse
import struct
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--merge-mode", type=int, default=0, choices=(0, 1))
    p.add_argument("--layer", type=int, default=0)
    p.add_argument("--tensor-suffix", default="attn_q.weight", help="or full name starting with blk.")
    p.add_argument("--payload-size", type=int, default=0, help="mode 0: bytes; mode 1: use --nelements")
    p.add_argument("--nelements", type=int, default=0, help="mode 1: element count (= payload bytes)")
    p.add_argument("--delta-scale", type=float, default=0.01)
    p.add_argument("--fill", type=int, default=0, help="byte value for mode 0 payload (default 0)")
    args = p.parse_args()

    suffix = args.tensor_suffix.encode("utf-8")[:63]
    suffix_field = suffix + b"\x00" * (64 - len(suffix))

    if args.merge_mode == 1:
        n = args.nelements or args.payload_size
        if n <= 0:
            raise SystemExit("mode 1 requires --nelements (or --payload-size) > 0")
        payload_size = n
        payload = bytes([0] * n)
    else:
        payload_size = args.payload_size
        if payload_size <= 0:
            raise SystemExit("mode 0 requires --payload-size > 0")
        payload = bytes([args.fill & 0xFF]) * payload_size

    header = bytearray(128)
    header[0:4] = b"QVP1"
    struct.pack_into("<I", header, 4, 1)  # version
    struct.pack_into("<I", header, 8, args.merge_mode)
    struct.pack_into("<I", header, 12, args.layer & 0xFFFFFFFF)
    struct.pack_into("<I", header, 16, 0)  # reserved
    header[20:84] = suffix_field
    struct.pack_into("<f", header, 84, float(args.delta_scale))
    struct.pack_into("<Q", header, 88, payload_size)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(bytes(header) + payload)
    print(f"Wrote {args.output} merge_mode={args.merge_mode} payload_size={payload_size}")


if __name__ == "__main__":
    main()
