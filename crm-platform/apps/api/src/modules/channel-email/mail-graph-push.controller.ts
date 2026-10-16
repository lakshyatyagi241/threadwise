import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { VALIDATION_TOKEN_MAX, notificationsOf } from './graph-push-rules';
import { MailGraphPushService } from './mail-graph-push.service';
import { MicrosoftMailConfig } from './microsoft-mail-config.service';

/**
 * Where Microsoft Graph delivers change notifications for Inbox mail (E-17). Public by design: there is no session, so the credential is
 * the `clientState` each subscription carries (an HMAC naming the workspace and mailbox, checked in `MailGraphPushService`; a forged
 * notification is dropped, silently).
 *
 *  - Validation handshake: when a subscription is created Graph POSTs `?validationToken=<token>` and expects it back as `text/plain`, status
 *    200, within ten seconds. Answered only while push is configured here (this is not an open echo endpoint), as plain text with
 *    `nosniff`, and at most {@link VALIDATION_TOKEN_MAX} characters.
 *  - Notifications and lifecycle events: a JSON body `{ value: [...] }`. Answered 202 at once (Graph wants an answer within three
 *    seconds and retries otherwise); the sync itself is queued for the worker. A body that is not that shape is a 400.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'public/email', version: '2' })
export class MailGraphPushController {
  constructor(
    private readonly config: MicrosoftMailConfig,
    private readonly push: MailGraphPushService,
  ) {}

  @Post('microsoft/push')
  @HttpCode(202)
  async receive(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const cfg = await this.config.push().catch(() => null);
    if (!cfg) {
      res.status(404).end();
      return;
    }
    const token = req.query.validationToken;
    if (typeof token === 'string') {
      if (token === '' || token.length > VALIDATION_TOKEN_MAX) {
        res.status(400).end();
        return;
      }
      res
        .status(200)
        .setHeader('Content-Type', 'text/plain; charset=utf-8')
        .setHeader('X-Content-Type-Options', 'nosniff')
        .send(token);
      return;
    }
    const items = notificationsOf(req.body);
    if (!items) {
      res.status(400).end();
      return;
    }
    res.status(202).end();
    // After the answer: a slow database must not make Graph time out and redeliver.
    void this.push.handle(items).catch(() => undefined);
  }
}
