import { deflateRaw, gunzip, gzip, inflateRaw, type InputType, type ZlibOptions } from 'node:zlib';
import { promisify } from 'node:util';

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
 * Walks the lines of a large NDJSON text and hands each non-empty one to `onLine`, yielding to the event loop every `every` lines so a
 * day's archive (tens of MB, hundreds of thousands of lines) is not parsed in one uninterrupted pass. Order and content are exactly
 * those of `text.split('\n')` with empty lines skipped.
 */
export async function forEachLine(
  text: string,
  onLine: (line: string) => void,
  every = 2_000,
): Promise<void> {
  let from = 0;
  let seen = 0;
  while (from <= text.length) {
    let to = text.indexOf('\n', from);
    if (to === -1) to = text.length;
    if (to > from) {
      onLine(text.slice(from, to));
      seen += 1;
      if (seen % every === 0) await yieldToLoop();
    }
    from = to + 1;
  }
}
