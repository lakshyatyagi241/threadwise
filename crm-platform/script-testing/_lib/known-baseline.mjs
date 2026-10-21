#!/usr/bin/env node
// Shared known-baseline classifier. Usage: node known-baseline.mjs <vitest-json-or-log> [--json]
// Prints which failing test files are the pristine-main baseline (known-failures.json) and which are NEW.
// Input: a vitest `--reporter=json` file, or any log text containing lines like `FAIL  path/to/file.spec.ts`.
// Exit code 0 when there are no NEW failures, 1 otherwise. With --json prints {baseline:[],new:[]}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const baseline = JSON.parse(fs.readFileSync(path.join(here, '..', 'known-failures.json'), 'utf8')).files;

export function failingFiles(text) {
  try {
    const j = JSON.parse(text);
    return [...new Set((j.testResults ?? []).filter((r) => r.status === 'failed').map((r) => r.name))];
  } catch {
    return [...new Set([...text.matchAll(/^\s*(?:FAIL|✗|×)\s+(\S+\.(?:spec|test)\.[cm]?[jt]sx?)/gm)].map((m) => m[1]))];
  }
}

export function classify(files) {
  const isBase = (f) => baseline.some((b) => f.includes(b));
  return { baseline: files.filter(isBase), new: files.filter((f) => !isBase(f)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: known-baseline.mjs <vitest-json-or-log> [--json]'); process.exit(2); }
  const r = classify(failingFiles(fs.readFileSync(file, 'utf8')));
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
  else {
    console.log(`known baseline failures (${r.baseline.length}):\n${r.baseline.map((f) => '  ' + f).join('\n') || '  none'}`);
    console.log(`NEW failures (${r.new.length}):\n${r.new.map((f) => '  ' + f).join('\n') || '  none'}`);
  }
  process.exit(r.new.length ? 1 : 0);
}
