import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { ERROR_CODES, MARKET_HOOK_MAX_BYTES } from '@crm/contracts';
import { Public } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { RelayService } from './relay.service';

type HookRequest = Request & { rawBody?: Buffer };

/**
 * The bytes of a body no global parser read (XML, `text/plain`, a form sender with a wrong Content-Type). A JSON or form body was
 * already read by the platform's parsers, which keep the raw bytes for signatures; for any other type the stream is untouched here.
 * Capped: what is over the cap is drained, never held, and the answer is 413.
 */
async function readRawBody(req: HookRequest): Promise<Buffer> {
  if (req.rawBody) return req.rawBody;
  if (req.method === 'GET' || req.method === 'HEAD' || req.readableEnded) return Buffer.alloc(0);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MARKET_HOOK_MAX_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MARKET_HOOK_MAX_BYTES) {
        reject(
          new AppError(
            ERROR_CODES.PAYLOAD_TOO_LARGE,
            'The delivery is too large.',
            HttpStatus.PAYLOAD_TOO_LARGE,
          ),
        );
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', reject);
  });
}

/**
 * The public delivery address of a push or webhook-relay connection. No session: the address names the connection and the sender proves
 * itself with the connection's secret (a header token, an HMAC of the raw body, or, for a sender that can set no header, the secret as
 * the last segment of the address). A portal that cannot POST (JustDial) delivers with GET and a query string. Not part of the documented
 * workspace API; the address and the authentication a sender must use are on the installation's manage page.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'public/marketplace', version: '2' })
export class HookController {
  constructor(private readonly relay: RelayService) {}

  @Post(['hooks/:publicKey', 'hooks/:publicKey/:token'])
  @HttpCode(HttpStatus.OK)
  async post(
    @Param('publicKey') publicKey: string,
    @Param('token') token: string | undefined,
    @Req() req: HookRequest,
  ) {
    return this.handle(publicKey, token, req);
  }

  @Get(['hooks/:publicKey', 'hooks/:publicKey/:token'])
  @HttpCode(HttpStatus.OK)
  async get(
    @Param('publicKey') publicKey: string,
    @Param('token') token: string | undefined,
    @Req() req: HookRequest,
  ) {
    return this.handle(publicKey, token, req);
  }

  private async handle(publicKey: string, token: string | undefined, req: HookRequest) {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers))
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    const at = req.originalUrl.indexOf('?');
    return this.relay.receive({
      publicKey,
      pathToken: token,
      method: req.method,
      ip: req.ip,
      headers,
      rawBody: await readRawBody(req),
      query: at === -1 ? '' : req.originalUrl.slice(at + 1),
    });
  }
}
