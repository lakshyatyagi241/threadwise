import { All, Controller, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { PaymentsService } from './payments.service';

const flat = (o: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((o ?? {}) as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );

const lower = (h: Request['headers']): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(h).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]),
  );

/**
 * The public doors (TW-PAYGW-026, 027). No JWT: the order token (return) and the provider signature (webhook) are the
 * authentication, and both are checked in PaymentsService before anything changes.
 */
@ApiTags('payments')
@Public()
@Controller({ path: 'payments', version: '2' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Providers send the buyer back by GET (redirect) or POST (the Razorpay form); both end in a redirect to the web app. */
  @All('return/:slug')
  @ApiOperation({
    summary:
      'The buyer returns from a gateway; confirm the payment and redirect to the order history',
  })
  async paymentReturn(
    @Param('slug') slug: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const params = { ...flat(req.body), ...flat(query) };
    res.redirect(303, await this.payments.handleReturn(slug, params));
  }

  @Post('webhook/:slug')
  @ApiOperation({
    summary: 'Asynchronous provider notification (signature-verified, 200 once authenticated)',
  })
  webhook(@Param('slug') slug: string, @Req() req: Request & { rawBody?: Buffer }) {
    return this.payments.handleWebhook(slug, req.rawBody ?? Buffer.alloc(0), lower(req.headers));
  }
}
