import { Injectable } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { extname } from 'node:path';

/** What WaDesk allowed to follow (WD-NODE-028). */
export const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
/** WhatsApp's own ceiling for a document is 100 MB; WaDesk had no cap of its own, so a hostile host could fill the disk. */
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

/** Thrown for a target we refuse to fetch. The message is the one WaDesk's bridge reported. */
export class UnsafeMediaUrlError extends Error {}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, includes the cloud metadata address
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 3], // multicast and reserved: 224.0.0.0 and up
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['fc00::', 7],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** Loopback, private, link-local, CGNAT, multicast and reserved addresses, and their IPv4-mapped IPv6 forms. */
export function isBlockedAddress(address: string): boolean {
  const v = address.toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapped) return isBlockedAddress(mapped[1]!);
  const family = isIP(v);
  return family !== 0 && blocked.check(v, family === 4 ? 'ipv4' : 'ipv6');
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mkv': 'video/x-matroska',
  '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/ogg; codecs=opus',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
};
export const DEFAULT_MIME = 'application/octet-stream';

/** The media type of a download: the server's own `content-type` first, else the URL's extension, else a binary default. */
export function resolveMime(contentType: string | undefined, url: string): string {
  const header = contentType?.split(';')[0]?.trim().toLowerCase();
  if (header && header !== DEFAULT_MIME) return header;
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* a bare name: use it as is */
  }
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? DEFAULT_MIME;
}

/** The file extension to name a download with, so an image is not delivered as a `.bin` document. Default `.jpg` as WaDesk. */
export function extensionFor(mime: string, url: string): string {
  const fromUrl = (() => {
    try {
      return extname(new URL(url).pathname).toLowerCase();
    } catch {
      return '';
    }
  })();
  if (fromUrl && MIME_BY_EXT[fromUrl]) return fromUrl;
  const base = mime.split(';')[0]!.trim().toLowerCase();
  return Object.entries(MIME_BY_EXT).find(([, m]) => m.split(';')[0] === base)?.[0] ?? '.jpg';
}

export interface FetchedMedia {
  buffer: Buffer;
  mimetype: string;
  extension: string;
  finalUrl: string;
}

export interface SafeRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeResponse {
  status: number;
  headers: IncomingMessage['headers'];
  text: string;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * The one door for fetching a URL a user typed (WD-NODE-028): media for a send today, webhooks and HTTP nodes later.
 *
 * WaDesk's bridge checked the first hop only, so an allowed host could redirect to an internal one. Here every hop is checked,
 * every address a name resolves to is checked, and the connection is pinned to the address that was checked (no second lookup
 * for an attacker to answer differently). Local file paths are not accepted at all: media comes from a URL or from storage.
 */
@Injectable()
export class SafeFetch {
  /** Overridable in tests, which serve from 127.0.0.1. */
  isBlocked: (address: string) => boolean = isBlockedAddress;

  /**
   * One guarded HTTP request for the Webhook node (WD-FLR-032): any method, headers and body, the same address checks and
   * pinning as media, and NO redirect following (WaDesk failed closed on a 3xx so a public host could not bounce a flow onto an
   * internal one). Resolves with the body as text whatever the status; the caller decides what a non-2xx means.
   */
  async request(url: string, init: SafeRequestInit = {}): Promise<SafeResponse> {
    const res = await this.get(url, init.timeoutMs ?? DEFAULT_TIMEOUT_MS, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body,
    });
    const body = await this.read(res, init.maxBytes ?? DEFAULT_MAX_BYTES);
    return {
      status: res.statusCode ?? 0,
      headers: res.headers,
      text: body.toString('utf8'),
    };
  }

  /**
   * Throws UnsafeMediaUrlError unless every address `host` resolves to is public. For a client that opens its own connection (a
   * database driver): it must connect to the returned address, not look the name up again. Returns the first checked address.
   */
  async assertPublicHost(host: string): Promise<{ address: string; family: number }> {
    const h = host.replace(/^\[|\]$/g, '');
    if (h === '' || /^localhost$|\.localhost$|\.internal$|metadata\./i.test(h)) {
      throw new UnsafeMediaUrlError('Blocked internal host');
    }
    const addresses =
      isIP(h) !== 0
        ? [{ address: h, family: isIP(h) }]
        : await dnsLookup(h, { all: true }).catch(() => {
            throw new UnsafeMediaUrlError('Host could not be resolved.');
          });
    if (addresses.length === 0 || addresses.some((a) => this.isBlocked(a.address))) {
      throw new UnsafeMediaUrlError('Blocked internal host');
    }
    return addresses[0]!;
  }

  async fetchMedia(url: string, options: SafeFetchOptions = {}): Promise<FetchedMedia> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await this.get(current, timeoutMs);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        current = new URL(res.headers.location, current).toString();
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new Error(`Media host answered HTTP ${status}.`);
      }
      const buffer = await this.read(res, maxBytes);
      const mimetype = resolveMime(res.headers['content-type'], current);
      return { buffer, mimetype, extension: extensionFor(mimetype, current), finalUrl: current };
    }
    throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
  }

  /** One request to a checked address. Throws UnsafeMediaUrlError before any connection when the target is not allowed. */
  private async get(
    raw: string,
    timeoutMs: number,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<IncomingMessage> {
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw new UnsafeMediaUrlError('Media URL is not a valid URL.');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new UnsafeMediaUrlError('Media URL must be http(s).');
    }
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const addresses =
      isIP(host) !== 0
        ? [{ address: host, family: isIP(host) }]
        : await dnsLookup(host, { all: true }).catch(() => {
            throw new UnsafeMediaUrlError('Media host could not be resolved.');
          });
    if (addresses.length === 0 || addresses.some((a) => this.isBlocked(a.address))) {
      throw new UnsafeMediaUrlError('Blocked internal media host');
    }
    const pinned = addresses[0]!;
    const open = target.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = open(
        target,
        {
          method: init.method ?? 'GET',
          timeout: timeoutMs,
          headers: init.headers ?? { 'user-agent': 'WaDesk-Media/1.0', accept: '*/*' },
          // The address that was checked is the address that is used.
          lookup: (_h, opts, cb) =>
            (opts as { all?: boolean }).all
              ? (cb as unknown as (e: null, a: unknown[]) => void)(null, [pinned])
              : cb(null, pinned.address, pinned.family),
        },
        resolve,
      );
      req.on('timeout', () => req.destroy(new Error('Media host timed out.')));
      req.on('error', reject);
      req.end(init.body);
    });
  }

  private read(res: IncomingMessage, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new Error(`Media is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  }
}
