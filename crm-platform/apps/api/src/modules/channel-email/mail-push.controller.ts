import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../common/decorators';
import { GoogleOidcVerifier } from '../../infra/providers/channel-email';
import { GoogleMailConfig } from './mail-config.service';
import { MailPushService } from './mail-push.service';

/** Pub/Sub's push envelope: only `message.data` matters (base64 of `{ emailAddress, historyId }`). */
const envelopeSchema = z.object({ message: z.object({ data: z.string().max(4096) }) });
const dataSchema = z.object({
  emailAddress: z.string().trim().min(3).max(320),
  historyId: z.union([z.string(), z.number()]).transform(String),
});

/**
 * Where Google Pub/Sub delivers Gmail notifications (TW-MAIL-033). Public by design: the credential is the OIDC ID token the push
 * subscription attaches (`Authorization: Bearer`), verified against Google's keys, the configured audience and the configured service
 * account BEFORE the body is read. Anything that fails answers 401 with no body and no hint. A verified notification is answered 204 at
 * once (also when the address is unknown or the id is stale: Pub/Sub would only redeliver); the sync itself runs in the worker.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'public/email', version: '2' })
export class MailPushController {
  constructor(
    private readonly verifier: GoogleOidcVerifier,
    private readonly config: GoogleMailConfig,
    private readonly push: MailPushService,
  ) {}

  @Post('google/push')
  @HttpCode(204)
  async receive(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const header = req.header('authorization') ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const cfg = await this.config.push().catch(() => null);
    if (!token || !cfg) {
      res.status(401).end();
      return;
    }
    const verdict = await this.verifier.verify(token, {
      audience: cfg.audience,
      email: cfg.serviceAccount,
    });
    if (!verdict.ok) {
      res.status(401).end();
      return;
    }
    const envelope = envelopeSchema.safeParse(req.body);
    let data: z.infer<typeof dataSchema> | null = null;
    if (envelope.success) {
      try {
        const parsed = dataSchema.safeParse(
          JSON.parse(Buffer.from(envelope.data.message.data, 'base64').toString('utf8')),
        );
        data = parsed.success ? parsed.data : null;
      } catch {
        data = null;
      }
    }
    if (data) {
      try {
        await this.push.notify(data.emailAddress, data.historyId);
      } catch {
        // Not acknowledging would only make Pub/Sub retry; the reconcile poll catches up either way.
      }
    }
    res.status(204).end();
  }
}
