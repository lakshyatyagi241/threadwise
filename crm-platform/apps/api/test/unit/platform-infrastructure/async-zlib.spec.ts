import { deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  deflateRawAsync,
  forEachLine,
  gunzipAsync,
  gzipAsync,
  inflateRawAsync,
} from '../../../src/common/async-zlib';

// EL-B08: the export runners, the archive sweep and the readers moved from the *Sync zlib calls to these. The output has to be the same
// bytes, and the line walker has to be the same walk as split('\n') with empty lines skipped.
const sample = (n: number) =>
  Array.from({ length: n }, (_, i) => `row ${i},"hello ${i % 97}",${i * 31}\r\n`).join('');

describe('async zlib', () => {
  it('gzipAsync writes the same bytes as gzipSync, for a string and for a buffer', async () => {
    const text = sample(2_000);
    expect((await gzipAsync(text)).equals(gzipSync(text))).toBe(true);
    expect((await gzipAsync(Buffer.from(text))).equals(gzipSync(Buffer.from(text)))).toBe(true);
    expect((await gzipAsync('')).equals(gzipSync(''))).toBe(true);
  });

  it('gunzipAsync reads what gzipSync wrote, including concatenated members', async () => {
    const a = gzipSync('first\n');
    const b = gzipSync('second\n');
    expect((await gunzipAsync(Buffer.concat([a, b]))).toString()).toBe('first\nsecond\n');
    expect((await gunzipAsync(a)).equals(gunzipSync(a))).toBe(true);
  });

  it('deflateRawAsync and inflateRawAsync match their sync twins, with options', async () => {
    const data = Buffer.from(sample(3_000));
    expect((await deflateRawAsync(data)).equals(deflateRawSync(data))).toBe(true);
    expect(
      (await deflateRawAsync(data, { level: 9 })).equals(deflateRawSync(data, { level: 9 })),
    ).toBe(true);
    const packed = deflateRawSync(data);
    expect((await inflateRawAsync(packed)).equals(inflateRawSync(packed))).toBe(true);
    await expect(inflateRawAsync(packed, { maxOutputLength: 10 })).rejects.toThrow();
  });

  it('a corrupt stream rejects instead of throwing out of the event loop', async () => {
    await expect(gunzipAsync(Buffer.from('not gzip at all'))).rejects.toThrow();
  });
});

describe('forEachLine', () => {
  const walk = async (text: string, every?: number) => {
    const got: string[] = [];
    await forEachLine(text, (l) => got.push(l), every);
    return got;
  };
  const reference = (text: string) => text.split('\n').filter((l) => l !== '');

  it('visits the same lines in the same order as split + skip-empty, for awkward inputs', async () => {
    for (const text of [
      '',
      '\n',
      '\n\n\n',
      'one',
      'one\n',
      '\none\n\ntwo\n',
      'a\nb\nc',
      'a\nb\nc\n',
      'x\r\ny\r\n', // CR stays on the line, as with split('\n')
      '{"a":1}\n{"a":2}\n',
    ]) {
      expect(await walk(text, 2), JSON.stringify(text)).toEqual(reference(text));
    }
  });

  it('matches on a big input with a small yield interval', async () => {
    const text = Array.from({ length: 9_999 }, (_, i) => (i % 50 === 0 ? '' : `line ${i}`)).join(
      '\n',
    );
    expect(await walk(text, 7)).toEqual(reference(text));
  });

  it('lets other work run while it walks (a timer set before it fires before it finishes)', async () => {
    const text = Array.from({ length: 20_000 }, (_, i) => `{"i":${i}}`).join('\n');
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    let firedBeforeEnd = false;
    await forEachLine(text, () => undefined, 1_000);
    firedBeforeEnd = timerFired;
    expect(firedBeforeEnd).toBe(true);
  });

  it('a throwing callback rejects the walk and stops it', async () => {
    let seen = 0;
    await expect(
      forEachLine('a\nb\nc\n', () => {
        seen += 1;
        if (seen === 2) throw new Error('bad line');
      }),
    ).rejects.toThrow('bad line');
    expect(seen).toBe(2);
  });
});
