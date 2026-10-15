import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRawWrites } from '../raw-writes';

describe('raw-writes.json', () => {
  it('matches the hand-written SQL in load/ and transform/ (regenerate: tsx pilot/staging/raw-writes.ts)', () => {
    const checked = JSON.parse(readFileSync(resolve(__dirname, '../raw-writes.json'), 'utf8'));
    expect(scanRawWrites()).toEqual(checked);
  });
});
