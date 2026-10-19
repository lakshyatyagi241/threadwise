import compression from 'compression';
import { constants as zlib } from 'node:zlib';
import type { Request, RequestHandler, Response } from 'express';

/** Bodies smaller than this are sent as they are: the gzip header and the CPU cost outweigh the saving. */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * Which responses are compressed (QA 63). The library's own rule (text, JSON, JavaScript, SVG and other compressible types) plus two
 * exceptions: a server-sent-events stream, which gzip would hold back until its buffer fills, and a request that opts out with
 * `x-no-compression`. A response that already carries a content-encoding is left alone.
 */
export function shouldCompress(req: Request, res: Response): boolean {
  if (req.headers['x-no-compression']) return false;
  const type = String(res.getHeader('content-type') ?? '');
  if (type.startsWith('text/event-stream')) return false;
  return compression.filter(req, res);
}

/**
 * gzip/brotli for API responses. Measured on the seeded benchmark organisation, a 50-contact page is 52 KB uncompressed and 3.9 KB
 * compressed. Level 4 (gzip) and quality 4 (brotli, whose default of 11 is far too slow for a response) keep the CPU cost low: the work
 * runs on the libuv thread pool, not the event loop.
 * Turn it off with RESPONSE_COMPRESSION=false when a proxy in front of the API already compresses.
 */
export function responseCompression(): RequestHandler {
  return compression({
    threshold: COMPRESSION_THRESHOLD_BYTES,
    level: 4,
    brotli: { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } },
    filter: shouldCompress,
  });
}
