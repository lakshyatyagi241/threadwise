import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import {
  createGunzip,
  deflateRaw,
  gunzip,
  gzip,
  inflateRaw,
  type InputType,
  type ZlibOptions,
} from 'node:zlib';

/**
 * Compression on libuv's thread pool instead of the event loop (docs/performance/event-loop, EL-B08). `gzipSync` and its siblings run
 * on the calling thread for as long as the payload takes: measured on a developer laptop, one 5,000-row export page (1.2 to 6 MB) held
 * the loop for 80 to 600 ms and a 20,000-event archive batch for 200 ms to 1 s, while the same call through these held it for the
 * timer's own resolution. The bytes are identical to the sync functions' for the same input and options.
 */
export const gzipAsync: (input: InputType, options?: ZlibOptions) => Promise<Buffer> =
  promisify(gzip);
export const gunzipAsync: (input: InputType, options?: ZlibOptions) => Promise<Buffer> =
  promisify(gunzip);
export const deflateRawAsync: (input: InputType, options?: ZlibOptions) => Promise<Buffer> =
  promisify(deflateRaw);
export const inflateRawAsync: (input: InputType, options?: ZlibOptions) => Promise<Buffer> =
  promisify(inflateRaw);

/** Lets everything queued on the event loop run once (I/O callbacks, timers, other requests) before the caller carries on. */
export const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Hands every non-empty line of a gzip payload (one member or several concatenated) to `onLine`, decompressing as a stream: the text
 * never exists as one string, and the event loop runs between chunks. A day's archive object is tens of MB at volume; decoding it whole
 * held the loop about 170 ms at 120 MB even with the inflate off-thread (EL-B21). The lines and their order are exactly those of
 * `gunzipSync(payload).toString('utf8').split('\n')` with empty lines skipped. A corrupt payload, or a throwing `onLine`, rejects.
 */
export async function forEachGzipLine(
  payload: Buffer,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new StringDecoder('utf8');
  let tail = '';
  const take = (text: string) => {
    let from = 0;
    for (;;) {
      const to = text.indexOf('\n', from);
      if (to === -1) break;
      const line = from === 0 ? tail + text.slice(0, to) : text.slice(from, to);
      if (line !== '') onLine(line);
      if (from === 0) tail = '';
      from = to + 1;
    }
    tail = from === 0 ? tail + text : text.slice(from);
  };
  await pipeline(
    Readable.from([payload], { objectMode: false }),
    createGunzip({ chunkSize: 64 * 1024 }),
    async (source: AsyncIterable<Buffer>) => {
      for await (const chunk of source) take(decoder.write(chunk));
    },
  );
  take(decoder.end());
  if (tail !== '') onLine(tail);
}
