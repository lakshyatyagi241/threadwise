import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for the Graph API and for the host that serves WhatsApp media, both on 127.0.0.1 (two ports), for the unit and end-to-end
 * specs of the media pipeline. `META_API_ENDPOINT` and `INTERAKT_API_ENDPOINT` (the `WabaHttp` the spec builds, or a provider profile's `baseUrl`) point at `graphUrl`; the lookup answers with a
 * download address on the media server.
 *
 * It records every request (method, path, query, headers) so a spec can assert what was sent where, and every behaviour a spec needs is a
 * knob: a sequence of lookup outcomes (`lookup: ['500', 'ok']`), a download behaviour per media id (`ok`, `500`, `truncate`, `huge`,
 * `redirect:<url>`), the sha256 and file size announced, and what authentication it demands (Meta's bearer token, or a BSP's headers).
 */

export type LookupStep = 'ok' | '500' | '429' | '404' | '401' | 'no-url' | 'bad-json';
export type DownloadMode =
  'ok' | '403' | '500' | '404' | 'truncate' | 'huge' | 'slow' | `redirect:${string}`;

export interface FakeMediaFile {
  id: string;
  bytes: Buffer;
  mime: string;
  /** `'auto'`: the real sha256 as hex; `'auto-base64'`: as base64; a string: that value; null: not announced. */
  sha256?: 'auto' | 'auto-base64' | string | null;
  /** `'auto'`: the real size; a number: that value (a lie); null: not announced. */
  fileSize?: 'auto' | number | null;
  /** What the lookup answers on each call, in order; the last step repeats. Default: always `ok`. */
  lookup?: LookupStep[];
  /** What the download does on each call, in order; the last step repeats. Default: always `ok`. */
  download?: DownloadMode[];
  /** Skips the `Content-Length` header on the download (a chunked body the guard must count itself). */
  chunked?: boolean;
  /** The download address' host, when it should not be the media server (a name the spec resolves itself). */
  downloadUrl?: string;
}

export interface Recorded {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: IncomingHttpHeaders;
  server: 'graph' | 'media';
  /** For an upload: what the multipart body carried. */
  upload?: { fields: Record<string, string>; filename: string; fileType: string; bytes: Buffer };
}

export type AuthRule = (headers: IncomingHttpHeaders) => boolean;

export const bearer =
  (token: string): AuthRule =>
  (h) =>
    h.authorization === `Bearer ${token}`;

export const bspHeaders =
  (token: string, waba: string): AuthRule =>
  (h) =>
    h['x-access-token'] === token && h['x-waba-id'] === waba && h.authorization === undefined;

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/** Splits a multipart body into its fields and its single file part. */
function parseMultipart(body: Buffer, contentType: string): Recorded['upload'] {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) return undefined;
  const sep = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: { filename: string; fileType: string; bytes: Buffer } = {
    filename: '',
    fileType: '',
    bytes: Buffer.alloc(0),
  };
  let at = body.indexOf(sep);
  while (at !== -1) {
    const next = body.indexOf(sep, at + sep.length);
    if (next === -1) break;
    const part = body.subarray(at + sep.length + 2, next - 2); // skip CRLF after the boundary and before the next
    const headEnd = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, headEnd).toString('utf8');
    const data = part.subarray(headEnd + 4);
    const name = /name="([^"]*)"/.exec(head)?.[1] ?? '';
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    if (filename !== undefined) {
      file = {
        filename,
        fileType: /Content-Type: (.+)/i.exec(head)?.[1]?.trim() ?? '',
        bytes: data,
      };
    } else {
      fields[name] = data.toString('utf8');
    }
    at = next;
  }
  return { fields, ...file };
}

export class FakeGraph {
  readonly requests: Recorded[] = [];
  private files = new Map<string, FakeMediaFile>();
  private lookupCalls = new Map<string, number>();
  private downloadCalls = new Map<string, number>();
  private uploads = 0;
  private graph!: Server;
  private media!: Server;
  graphUrl = '';
  mediaUrl = '';
  /** What the Graph endpoints demand. Default: any non-empty authorization or x-access-token. */
  auth: AuthRule = (h) => Boolean(h.authorization || h['x-access-token']);
  /** What a download from the media server demands, when it should demand anything. Null: nothing. */
  mediaAuth: AuthRule | null = null;
  /** The upload endpoint answers 404 (a provider without one). */
  noUploadEndpoint = false;
  /** What an upload answers: an HTTP status and body. Default: 200 `{ id }`. */
  uploadAnswer: (n: number) => { status: number; body: unknown } = (n) => ({
    status: 200,
    body: { id: `uploaded-${n}` },
  });
  /** How long the media server waits before the first byte of a `slow` download. */
  slowMs = 5_000;

  async start(): Promise<this> {
    this.media = createServer((req, res) => void this.onMedia(req, res));
    await new Promise<void>((r) => this.media.listen(0, '127.0.0.1', r));
    this.mediaUrl = `http://127.0.0.1:${(this.media.address() as AddressInfo).port}`;
    this.graph = createServer((req, res) => void this.onGraph(req, res));
    await new Promise<void>((r) => this.graph.listen(0, '127.0.0.1', r));
    this.graphUrl = `http://127.0.0.1:${(this.graph.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.media.closeAllConnections();
    this.graph.closeAllConnections();
    await Promise.all([
      new Promise((r) => this.media.close(r)),
      new Promise((r) => this.graph.close(r)),
    ]);
  }

  add(file: FakeMediaFile): this {
    this.files.set(file.id, file);
    return this;
  }

  lookups(id: string): number {
    return this.lookupCalls.get(id) ?? 0;
  }

  downloads(id: string): number {
    return this.downloadCalls.get(id) ?? 0;
  }

  uploadCount(): number {
    return this.uploads;
  }

  of(server: Recorded['server']): Recorded[] {
    return this.requests.filter((r) => r.server === server);
  }

  /** Everything the server saw, as text: what a spec greps for a leaked secret. */
  dump(): string {
    return JSON.stringify(
      this.requests.map((r) => ({
        ...r,
        upload: r.upload ? { ...r.upload, bytes: undefined } : undefined,
      })),
    );
  }

  private record(
    server: Recorded['server'],
    req: IncomingMessage,
    upload?: Recorded['upload'],
  ): Recorded {
    const url = new URL(req.url ?? '/', 'http://x');
    const r: Recorded = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      server,
      upload,
    };
    this.requests.push(r);
    return r;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async onGraph(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    const segments = url.pathname.split('/').filter(Boolean); // [version, id] or [version, phone, 'media']

    if (req.method === 'POST' && segments[2] === 'media') {
      const body = await readBody(req);
      this.record('graph', req, parseMultipart(body, String(req.headers['content-type'] ?? '')));
      if (!this.auth(req.headers))
        return this.json(res, 401, {
          error: { message: 'Invalid OAuth access token.', code: 190 },
        });
      if (this.noUploadEndpoint)
        return this.json(res, 404, { error: { message: 'Unknown path components', code: 2500 } });
      this.uploads += 1;
      const answer = this.uploadAnswer(this.uploads);
      return this.json(res, answer.status, answer.body);
    }

    this.record('graph', req);
    if (!this.auth(req.headers))
      return this.json(res, 401, { error: { message: 'Invalid OAuth access token.', code: 190 } });
    const id = segments[1] ?? '';
    const file = this.files.get(id);
    const n = (this.lookupCalls.get(id) ?? 0) + 1;
    this.lookupCalls.set(id, n);
    if (!file)
      return this.json(res, 400, {
        error: {
          message: 'Unsupported get request. Object does not exist',
          code: 100,
          error_subcode: 33,
        },
      });

    const steps = file.lookup ?? ['ok'];
    const step = steps[Math.min(n, steps.length) - 1]!;
    switch (step) {
      case '500':
        return this.json(res, 500, {
          error: { message: 'An unexpected error has occurred.', code: 2 },
        });
      case '429':
        return this.json(res, 429, { error: { message: 'Too many calls', code: 80007 } });
      case '404':
        return this.json(res, 404, { error: { message: 'Not found', code: 100 } });
      case '401':
        return this.json(res, 401, { error: { message: 'Session expired', code: 190 } });
      case 'bad-json':
        res.writeHead(200, { 'content-type': 'application/json' });
        return void res.end('not json {');
      case 'no-url':
        return this.json(res, 200, { id, messaging_product: 'whatsapp' });
      case 'ok': {
        const sha = createHash('sha256').update(file.bytes);
        const digest = sha.digest();
        const announced =
          file.sha256 === 'auto' || file.sha256 === undefined
            ? digest.toString('hex')
            : file.sha256 === 'auto-base64'
              ? digest.toString('base64')
              : file.sha256;
        return this.json(res, 200, {
          messaging_product: 'whatsapp',
          id,
          url: file.downloadUrl ?? `${this.mediaUrl}/files/${id}`,
          mime_type: file.mime,
          ...(announced === null ? {} : { sha256: announced }),
          ...(file.fileSize === null
            ? {}
            : {
                file_size:
                  file.fileSize === 'auto' || file.fileSize === undefined
                    ? file.bytes.length
                    : file.fileSize,
              }),
        });
      }
    }
  }

  private async onMedia(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.record('media', req);
    const url = new URL(req.url ?? '/', 'http://x');
    if (this.mediaAuth && !this.mediaAuth(req.headers)) {
      res.writeHead(401);
      return void res.end('unauthorized');
    }
    const id = url.pathname.replace('/files/', '').replace('/elsewhere/', '');
    const file = this.files.get(id);
    if (!file) {
      res.writeHead(404);
      return void res.end();
    }
    const n = (this.downloadCalls.get(id) ?? 0) + 1;
    this.downloadCalls.set(id, n);
    const modes = file.download ?? ['ok'];
    const mode = modes[Math.min(n, modes.length) - 1]!;

    if (mode === '500') {
      res.writeHead(500);
      return void res.end('boom');
    }
    if (mode === '404') {
      res.writeHead(404);
      return void res.end('gone');
    }
    if (mode === '403') {
      // A bare refusal, like the file host's own XML answer for a link it will not serve (no Graph error code).
      res.writeHead(403, { 'content-type': 'application/xml' });
      return void res.end('<Error><Code>AccessDenied</Code></Error>');
    }
    if (mode.startsWith('redirect:')) {
      res.writeHead(302, { location: mode.slice('redirect:'.length) });
      return void res.end();
    }
    if (mode === 'slow') await new Promise((r) => setTimeout(r, this.slowMs));
    if (mode === 'huge') {
      // No Content-Length: the client has to notice the size while reading. Streams until the client gives up.
      res.writeHead(200, { 'content-type': file.mime });
      const chunk = Buffer.alloc(64 * 1024, 7);
      const timer = setInterval(() => {
        if (!res.write(chunk)) return;
      }, 1);
      res.on('close', () => clearInterval(timer));
      return;
    }
    const headers: Record<string, string | number> = { 'content-type': file.mime };
    if (!file.chunked && mode !== 'truncate') headers['content-length'] = file.bytes.length;
    if (mode === 'truncate') {
      // Announces the whole file, sends half, and drops the connection.
      headers['content-length'] = file.bytes.length;
      res.writeHead(200, headers);
      res.write(file.bytes.subarray(0, Math.floor(file.bytes.length / 2)));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.writeHead(200, headers);
    res.end(file.bytes);
  }
}

/** A real, minimal PNG: signature plus padding. Enough for the content sniffer and the upload policy. */
export const pngBytes = (size = 2048, fill = 1): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(Math.max(0, size - 8), fill),
  ]);

export const pdfBytes = (size = 4096, fill = 2): Buffer =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, size - 9), fill)]);

/** An Ogg container whose first page names the Opus codec (what a WhatsApp voice note is). */
export const oggOpusBytes = (size = 4096): Buffer =>
  Buffer.concat([
    Buffer.from('OggS', 'ascii'),
    Buffer.alloc(24, 0),
    Buffer.from('OpusHead', 'ascii'),
    Buffer.alloc(Math.max(0, size - 36), 5),
  ]);

export const sha256Hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
