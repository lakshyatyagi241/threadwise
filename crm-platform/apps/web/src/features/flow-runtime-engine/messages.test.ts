import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLOW_RUN_END_REASONS,
  FLOW_RUN_SOURCES,
  FLOW_RUN_STATUSES,
  FLOW_SUBSCRIBER_STATUSES,
  FLR_ERROR_CODES,
} from '@crm/contracts';
import { errorKey } from './lib/model';

/**
 * Every literal message key a component asks for exists in messages/en/flow-runtime-engine.json (next-intl would otherwise print
 * the key path on screen), and every enum value the API can send has a label.
 */
const WEB = resolve(__dirname, '../../..');
type Tree = { [k: string]: string | Tree };
const tree = JSON.parse(
  readFileSync(join(WEB, 'messages/en/flow-runtime-engine.json'), 'utf8'),
) as Tree;

function has(path: string): boolean {
  let cur: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === undefined) return false;
    cur = cur[part];
  }
  return cur !== undefined;
}

const dir = join(__dirname, 'components');
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

describe('flow runtime messages', () => {
  it.each(files)('%s asks only for keys that exist', (file) => {
    const blocks = readFileSync(join(dir, file), 'utf8').split(/\n(?=export function |function )/);
    const missing: string[] = [];
    for (const src of blocks) {
      const namespaces = [...src.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)].map(
        (m) => [m[1]!, m[2]!] as const,
      );
      for (const [v, ns] of namespaces)
        for (const m of src.matchAll(new RegExp(`\\b${v}\\('([^']+)'`, 'g')))
          if (!has(`${ns}.${m[1]}`)) missing.push(`${ns}.${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('labels every status, source, end reason and error code', () => {
    const missing = [
      ...FLOW_RUN_STATUSES.map((s) => `flr.status.${s}`),
      ...FLOW_SUBSCRIBER_STATUSES.map((s) => `flr.subscriberStatus.${s}`),
      ...FLOW_RUN_SOURCES.map((s) => `flr.source.${s}`),
      ...FLOW_RUN_END_REASONS.map((s) => `flr.endReason.${s}`),
      ...Object.values(FLR_ERROR_CODES)
        .map((c) => errorKey(c))
        .filter((k): k is string => k !== null)
        .map((k) => `flr.errors.${k}`),
    ].filter((p) => !has(p));
    expect(missing).toEqual([]);
    // FLR_ENROLL_FAILED carries the server's own words (details.reason), so it has no fixed sentence.
    expect(Object.values(FLR_ERROR_CODES).filter((c) => errorKey(c) === null)).toEqual([
      'FLR_ENROLL_FAILED',
    ]);
  });
});
