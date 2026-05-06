/**
 * Router LoRA training (QVAC / llama-finetune-lora)
 *
 * 1. Converts Training/router_training_data.csv → JSONL (HF messages format).
 * 2. Runs llama-finetune-lora with assistant-only loss and checkpoints every N steps.
 *
 * iGPU (Vulkan): set GGML_VK_VISIBLE_DEVICES=0 so the first Vulkan device is used
 * (typically integrated on hybrid laptops). Requires a Vulkan-enabled llama-finetune-lora build.
 *
 * Usage:
 *   node Training/train_router_lora.mjs
 *   node Training/train_router_lora.mjs --csv Training/router_training_data.csv --checkpoint-steps 50
 *   node Training/train_router_lora.mjs --resume-from Training/lora_checkpoints/checkpoint_step_00000150
 *
 * @see qvac-fabric-llm.cpp/examples/training/README.md
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { convertRouterCsvToJsonl } from './csv_to_router_jsonl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    csv: join(repoRoot, 'Training', 'router_training_data.csv'),
    jsonl: join(repoRoot, 'Training', 'router_training_data.jsonl'),
    model: join(repoRoot, 'bitnet-b1.58-2B-4T-gguf', 'ms-2b-4t-pure.gguf'),
    outputAdapter: join(repoRoot, 'bitnet-b1.58-2B-4T-gguf', 'router-lora.gguf'),
    checkpointDir: join(repoRoot, 'Training', 'lora_checkpoints'),
    checkpointSteps: 50,
    finetuneExe: null,
    ngl: 999,
    ctx: 4096,
    batch: 512,
    resumeFrom: null,
    skipConvert: false,
    dryRun: false,
  };
  const cwd = process.cwd();
  const p = (v) => resolve(cwd, v);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--csv') out.csv = p(next());
    else if (a === '--jsonl') out.jsonl = p(next());
    else if (a === '--model' || a === '-m') out.model = p(next());
    else if (a === '--out' || a === '--output-adapter') out.outputAdapter = p(next());
    else if (a === '--checkpoint-dir') out.checkpointDir = p(next());
    else if (a === '--checkpoint-steps') out.checkpointSteps = parseInt(next(), 10);
    else if (a === '--exe') out.finetuneExe = p(next());
    else if (a === '--ngl') out.ngl = parseInt(next(), 10);
    else if (a === '-c' || a === '--ctx') out.ctx = parseInt(next(), 10);
    else if (a === '-b' || a === '--batch') out.batch = parseInt(next(), 10);
    else if (a === '--resume-from') out.resumeFrom = p(next());
    else if (a === '--skip-convert') out.skipConvert = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--cpu') out.ngl = 0;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function findFinetuneExe(explicit) {
  if (explicit && existsSync(explicit)) return explicit;
  const base = join(repoRoot, 'qvac-fabric-llm.cpp', 'build', 'bin');
  const name = process.platform === 'win32' ? 'llama-finetune-lora.exe' : 'llama-finetune-lora';
  const candidates = [
    join(base, 'Release', name),
    join(base, 'Debug', name),
    join(base, name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`train_router_lora.mjs

Options:
  --csv PATH              Input CSV (default: Training/router_training_data.csv)
  --jsonl PATH            Output JSONL (default: Training/router_training_data.jsonl)
  --model PATH            Base GGUF (-m)
  --out PATH              Output adapter GGUF (--output-adapter)
  --checkpoint-dir PATH   --checkpoint-save-dir (default: Training/lora_checkpoints)
  --checkpoint-steps N    --checkpoint-save-steps (default: 50)
  --exe PATH              llama-finetune-lora binary
  --ngl N                 GPU layers (default: 999; use --cpu for 0)
  -c / --ctx N            Context length (default: 4096)
  -b / --batch N          -b and -ub (default: 512)
  --resume-from PATH      Resume from checkpoint directory
  --skip-convert          Skip CSV→JSONL (reuse existing JSONL)
  --dry-run               Print command only
  --cpu                   Train on CPU (-ngl 0)
`);
    return;
  }

  if (!opts.skipConvert) {
    console.log('Converting CSV → JSONL…');
    const n = convertRouterCsvToJsonl(opts.csv, opts.jsonl);
    console.log(`Wrote ${n} examples → ${opts.jsonl}`);
  } else if (!existsSync(opts.jsonl)) {
    console.error('Missing JSONL:', opts.jsonl);
    process.exit(1);
  }

  if (!existsSync(opts.model)) {
    console.error('Base model not found:', opts.model);
    process.exit(1);
  }

  const exe = findFinetuneExe(opts.finetuneExe);
  if (!exe) {
    console.error(
      'llama-finetune-lora not found. Build qvac-fabric-llm.cpp (Release) or pass --exe PATH.',
    );
    process.exit(1);
  }

  mkdirSync(opts.checkpointDir, { recursive: true });

  const args = [
    '-m',
    opts.model,
    '-f',
    opts.jsonl,
    '-ngl',
    String(opts.ngl),
    '-c',
    String(opts.ctx),
    '-b',
    String(opts.batch),
    '-ub',
    String(opts.batch),
    '-fa',
    'off',
    '--lora-modules',
    'attn_q,attn_k,attn_v,attn_o',
    '--assistant-loss-only',
    '--checkpoint-save-steps',
    String(opts.checkpointSteps),
    '--checkpoint-save-dir',
    opts.checkpointDir,
    '--output-adapter',
    opts.outputAdapter,
  ];
  if (opts.resumeFrom) {
    args.push('--resume-from', opts.resumeFrom);
  }

  const env = {
    ...process.env,
    GGML_VK_VISIBLE_DEVICES: process.env.GGML_VK_VISIBLE_DEVICES ?? '0',
  };

  console.log('Running:', exe);
  console.log(args.join(' '));
  if (opts.dryRun) return;

  const r = spawnSync(exe, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

main();
