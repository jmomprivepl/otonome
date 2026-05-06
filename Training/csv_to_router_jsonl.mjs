#!/usr/bin/env node
/**
 * Converts Training/router_training_data.csv → JSONL for llama-finetune-lora (QVAC Fabric / llama.cpp).
 *
 * Each output line is one JSON object:
 *   { "messages": [ { "role": "user", "content": "<prompt>" }, { "role": "assistant", "content": "[p1,...,p27]" } ] }
 * The assistant content is JSON.stringify of 27 integers (ternary-style labels from CSV).
 *
 * Usage:
 *   node Training/csv_to_router_jsonl.mjs [input.csv] [output.jsonl]
 * Defaults: Training/router_training_data.csv → Training/router_training_data.jsonl
 *
 * Extra columns (e.g. `reasoning`) after p27 are ignored.
 *
 * @see qvac-fabric-llm.cpp/examples/training/finetune-lora.cpp (binary: llama-finetune-lora)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** RFC4180-style parser: quoted fields, doubled quotes, commas, newlines inside quotes. */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/**
 * @param {string} inputPath absolute or cwd-relative CSV path
 * @param {string} outputPath absolute or cwd-relative JSONL path
 * @returns {number} number of examples written
 */
export function convertRouterCsvToJsonl(inputPath, outputPath) {
  const raw = readFileSync(inputPath, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length < 2) {
    throw new Error(`No data rows in CSV: ${inputPath}`);
  }

  const header = rows[0].map((h) => h.trim());
  const promptIdx = header.indexOf('prompt');
  if (promptIdx === -1) {
    throw new Error('Missing "prompt" column in header');
  }

  const pIndices = [];
  for (let k = 1; k <= 27; k++) {
    const name = `p${k}`;
    const idx = header.indexOf(name);
    if (idx === -1) {
      throw new Error(`Missing column "${name}" in header`);
    }
    pIndices.push(idx);
  }

  const lines = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length <= promptIdx) continue;

    const prompt = String(cells[promptIdx] ?? '').trim();
    if (!prompt) continue;

    const vec = pIndices.map((ci) => {
      const v = String(cells[ci] ?? '').trim();
      if (v === '') return 0;
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) {
        throw new Error(`Row ${r + 1}: invalid integer in parameter column: ${v}`);
      }
      return n;
    });

    const assistant = `[${vec.join(', ')}]`;
    const record = {
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: assistant },
      ],
    };
    lines.push(JSON.stringify(record));
  }

  writeFileSync(outputPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  return lines.length;
}

function main() {
  const argv = process.argv.slice(2);
  const inputPath = resolve(argv[0] ?? join(__dirname, 'router_training_data.csv'));
  const outputPath = resolve(argv[1] ?? join(__dirname, 'router_training_data.jsonl'));
  const n = convertRouterCsvToJsonl(inputPath, outputPath);
  console.log(`Wrote ${n} examples → ${outputPath}`);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    main();
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
}
