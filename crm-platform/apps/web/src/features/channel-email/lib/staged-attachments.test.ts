import { describe, expect, it } from 'vitest';
import {
  MAIL_ATTACHMENTS_MAX_COUNT,
  MAIL_ATTACHMENTS_TOTAL_MAX_BYTES,
  MAIL_ATTACHMENT_MAX_BYTES,
} from '@crm/contracts';
import {
  admit,
  extensionOf,
  readyIds,
  stagedFrom,
  stagedReducer,
  totalBytes,
  type StagedFile,
} from './staged-attachments';

const file = (name: string, size: number) => ({ name, size, type: 'text/plain' }) as File;
const staged = (name: string, size: number, patch: Partial<StagedFile> = {}): StagedFile => ({
  ...stagedFrom(file(name, size), name),
  ...patch,
});

describe('admit', () => {
  it('accepts ordinary files and refuses empty, blocked and oversized ones with a reason', () => {
    const { accepted, refused } = admit(
      [],
      [
        file('a.pdf', 100),
        file('empty.txt', 0),
        file('run.EXE', 10),
        file('big.zip', MAIL_ATTACHMENT_MAX_BYTES + 1),
      ],
    );
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf']);
    expect(refused).toEqual([
      { name: 'empty.txt', reason: 'empty' },
      { name: 'run.EXE', reason: 'blocked' },
      { name: 'big.zip', reason: 'tooLarge' },
    ]);
  });

  it('stops at the count cap, counting files already staged but not failed ones', () => {
    const existing = Array.from({ length: MAIL_ATTACHMENTS_MAX_COUNT - 1 }, (_, i) =>
      staged(`f${i}`, 1, { status: 'ready' }),
    );
    existing.push(staged('bad', 1, { status: 'failed' }));
    const { accepted, refused } = admit(existing, [file('x', 1), file('y', 1)]);
    expect(accepted).toHaveLength(1);
    expect(refused).toEqual([{ name: 'y', reason: 'tooMany' }]);
    const full = admit([...existing, staged('z', 1, { status: 'ready' })], [file('x', 1)]);
    expect(full.refused).toEqual([{ name: 'x', reason: 'tooMany' }]);
  });

  it('keeps the total under the message cap', () => {
    const half = MAIL_ATTACHMENTS_TOTAL_MAX_BYTES / 2;
    const { accepted, refused } = admit(
      [staged('a', half, { status: 'ready' })],
      [file('b', half), file('c', 1)],
    );
    expect(accepted.map((f) => f.name)).toEqual(['b']);
    expect(refused).toEqual([{ name: 'c', reason: 'totalTooLarge' }]);
  });
});

describe('stagedReducer', () => {
  it('moves a file from uploading to ready and exposes the ids to send', () => {
    let s = stagedReducer([], { type: 'add', items: [staged('a', 5), staged('b', 5)] });
    s = stagedReducer(s, { type: 'progress', key: 'a', progress: 40 });
    expect(s[0]?.progress).toBe(40);
    s = stagedReducer(s, { type: 'uploaded', key: 'a', id: 'id-a' });
    s = stagedReducer(s, { type: 'failed', key: 'b', error: 'MAIL_ATTACHMENT_TOO_LARGE' });
    expect(readyIds(s)).toEqual(['id-a']);
    expect(s[1]).toMatchObject({ status: 'failed', error: 'MAIL_ATTACHMENT_TOO_LARGE' });
    expect(totalBytes(s)).toBe(5);
    s = stagedReducer(s, { type: 'retry', key: 'b' });
    expect(s[1]).toMatchObject({ status: 'uploading', progress: 0, error: null });
    expect(stagedReducer(s, { type: 'remove', key: 'a' })).toHaveLength(1);
    expect(stagedReducer(s, { type: 'clear' })).toEqual([]);
  });
});

describe('extensionOf', () => {
  it('reads the last extension in lower case', () => {
    expect(extensionOf('a.tar.GZ')).toBe('gz');
    expect(extensionOf('README')).toBe('');
  });
});
