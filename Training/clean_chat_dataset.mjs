#!/usr/bin/env node
/**
 * Clean HF-style chat datasets (JSONL or JSON) for training.
 *
 * Drops any top-level record if **any** message has a missing/null/non-string role,
 * missing/null/non-string content, or blank content after trim.
 *
 * Usage:
 *   node Training/clean_chat_dataset.mjs [input.jsonl] [output.jsonl]
 *   node Training/clean_chat_dataset.mjs data.jsonl clean.jsonl --format json
 *   node Training/clean_chat_dataset.mjs --in Training/router_training_data.jsonl --out Training/router_clean.jsonl
 *
 * @typedef {{ role?: unknown; content?: unknown }} ChatMessage
 * @typedef {{ messages?: unknown }} ChatRecord
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @param {unknown} v */
function isNonBlankString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * @param {unknown} record
 * @returns {record is { messages: ChatMessage[] }}
 */
function recordHasValidMessages(record) {
  if (!record || typeof record !== 'object' || !('messages' in record)) return false;
  const { messages } = /** @type {ChatRecord} */ (record);
  if (!Array.isArray(messages) || messages.length === 0) return false;
  for (const m of messages) {
    if (!m || typeof m !== 'object') return false;
    if (!isNonBlankString(m.role)) return false;
    if (!isNonBlankString(m.content)) return false;
  }
  return true;
}

/**
 * @param {string} filePath
 * @returns {unknown[]}
 */
function loadRecords(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const ext = filePath.toLowerCase();
  if (ext.endsWith('.jsonl')) {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
    return lines.map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        throw new Error(`JSONL parse error at line ${i + 1}: ${/** @type {Error} */ (e).message}`);
      }
    });
  }
  if (ext.endsWith('.json')) {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j;
    return [j];
  }
  // Heuristic: first non-whitespace char
  const t = raw.trim();
  if (t.startsWith('[')) {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [j];
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`Line ${i + 1}: ${/** @type {Error} */ (e).message}`);
    }
  });
}

/**
 * @param {unknown[]} records
 * @param {'json'|'jsonl'} format
 * @returns {string}
 */
function serialize(records, format) {
  if (format === 'jsonl') {
    return records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  }
  return JSON.stringify(records, null, 2) + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  let format = /** @type {'json'|'jsonl'} */ ('jsonl');
  let inputPath = resolve(__dirname, 'router_training_data.jsonl');
  let outputPath = resolve(__dirname, 'router_training_data.clean.jsonl');

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format' || a === '-f') {
      const v = argv[++i];
      if (v !== 'json' && v !== 'jsonl') {
        console.error('--format must be json or jsonl');
        process.exit(1);
      }
      format = v;
    } else if (a === '--in' || a === '-i') {
      inputPath = resolve(process.cwd(), argv[++i]);
    } else if (a === '--out' || a === '-o') {
      outputPath = resolve(process.cwd(), argv[++i]);
    } else if (a === '-h' || a === '--help') {
      console.log(`clean_chat_dataset.mjs — drop records with invalid chat messages

Arguments (positional): [input] [output]
Flags:
  --in PATH     Input .json / .jsonl
  --out PATH    Output path (default extension → format jsonl unless --format json)
  --format json|jsonl   Output serialization (default: jsonl)
`);
      return;
    } else if (!a.startsWith('-')) {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) {
        inputPath = resolve(process.cwd(), a);
      } else {
        inputPath = resolve(process.cwd(), a);
        outputPath = resolve(process.cwd(), argv[++i]);
      }
    }
  }

  const records = loadRecords(inputPath);
  const kept = [];
  let dropped = 0;
  for (const r of records) {
    if (recordHasValidMessages(r)) {
      kept.push(r);
    } else {
      dropped++;
    }
  }

  writeFileSync(outputPath, serialize(kept, format), 'utf8');
  console.log(`Input: ${inputPath} (${records.length} records)`);
  console.log(`Kept: ${kept.length}, dropped: ${dropped}`);
  console.log(`Wrote → ${outputPath} (${format})`);
}

main();
