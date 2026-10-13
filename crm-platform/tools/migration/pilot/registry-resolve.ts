/**
 * Read-only helper for bin/mongo-export.cjs: reads a JSON array of collection names on stdin and prints
 * {"<name>": "<MIGRATE|MIGRATE_LATER|EXCLUDE|GAP|OPEN|UNKNOWN>"} using the migration tool's own registry. No other effect.
 */
import { resolve } from '../registry/index';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  const names: unknown = JSON.parse(raw);
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
    throw new Error('expected a JSON array of strings');
  }
  const out: Record<string, string> = {};
  for (const n of names as string[]) out[n] = resolve(n).disposition;
  process.stdout.write(JSON.stringify(out) + '\n');
});
