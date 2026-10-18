import { deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  deflateRawAsync,
  forEachGzipLine,
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

describe('forEachGzipLine', () => {
  const walk = async (payload: Buffer) => {
    const got: string[] = [];
    await forEachGzipLine(payload, (l) => got.push(l));
    return got;
  };
  const reference = (payload: Buffer) =>
    gunzipSync(payload)
      .toString('utf8')
      .split('\n')
      .filter((l) => l !== '');

  it('visits the same lines in the same order as gunzip + split + skip-empty, for awkward inputs', async () => {
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
      const gz = gzipSync(text);
      expect(await walk(gz), JSON.stringify(text)).toEqual(reference(gz));
    }
  });

  it('reads concatenated gzip members as one stream (the archive appends a member per batch)', async () => {
    const gz = Buffer.concat([
      gzipSync('first\nsecond\n'),
      gzipSync('third\n'),
      gzipSync('fourth'),
    ]);
    expect(await walk(gz)).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('keeps lines whole across chunk boundaries and does not split multi-byte characters', async () => {
    // Longer than the 64 KB stream chunk, with 3- and 4-byte characters at every position mod 7.
    const lines = Array.from(
      { length: 6_000 },
      (_, i) => `${'x'.repeat(i % 7)}€𝄞 line ${i} ünï${'y'.repeat(i % 50)}`,
    );
    const gz = gzipSync(`${lines.join('\n')}\n`);
    expect(gunzipSync(gz).length).toBeGreaterThan(64 * 1024 * 3);
    expect(await walk(gz)).toEqual(lines);
  });

  it('lets other work run while it streams (a timer set before it fires before it finishes)', async () => {
    const gz = gzipSync(Array.from({ length: 200_000 }, (_, i) => `{"i":${i}}`).join('\n'));
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    let firedAtLine = -1;
    let n = 0;
    await forEachGzipLine(gz, () => {
      n += 1;
      if (timerFired && firedAtLine < 0) firedAtLine = n;
    });
    expect(n).toBe(200_000);
    expect(firedAtLine).toBeGreaterThan(0);
    expect(firedAtLine).toBeLessThan(200_000);
  });

  it('a corrupt payload rejects', async () => {
    await expect(walk(Buffer.from('definitely not gzip'))).rejects.toThrow();
    const truncated = gzipSync('a\nb\nc\n'.repeat(5_000)).subarray(0, 40);
    await expect(walk(truncated)).rejects.toThrow();
  });

  it('a throwing callback rejects the walk and stops it', async () => {
    let seen = 0;
    await expect(
      forEachGzipLine(gzipSync('a\nb\nc\n'), () => {
        seen += 1;
        if (seen === 2) throw new Error('bad line');
      }),
    ).rejects.toThrow('bad line');
    expect(seen).toBe(2);
  });
});
