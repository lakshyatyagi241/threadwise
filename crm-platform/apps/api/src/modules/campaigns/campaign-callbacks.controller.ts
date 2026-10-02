import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Optional,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { uuidSchema } from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PacingRuntime, type DeliveryReceipt } from '../broadcasts';
import { CampaignCallbacksService } from './campaign-callbacks.service';
import { CampaignReceiptsService } from './campaign-receipts.service';
import { CampaignSweeper } from './campaign-sweeper.service';

const when = z.coerce.date().nullish();
const contactStatus = z.object({
  campaignId: uuidSchema,
  contactId: uuidSchema,
  status: z.enum(['queued', 'pending', 'sent', 'delivered', 'read', 'failed', 'unsubscribed']),
  errorMessage: z.string().max(1024).nullish(),
  providerMessageId: z.string().max(191).nullish(),
  variant: z.string().max(8).nullish(),
  sentAt: when,
  deliveredAt: when,
  readAt: when,
});
const campaignStatus = z.object({ campaignId: uuidSchema, status: z.string().max(32).nullish() });
const byId = z.object({
  messageId: z.string().min(1).max(191),
  status: z.enum(['queued', 'pending', 'sent', 'delivered', 'read', 'failed']),
  timestamp: when,
});
const response = z.object({
  campaignId: uuidSchema,
  contactId: uuidSchema,
  response: z.string().max(4096).nullish(),
  respondedAt: when,
});
const unsubscribe = z.object({ campaignId: uuidSchema, phone: z.string().min(1).max(32) });

/**
 * The calls the Node bridge makes about campaigns (TW-CAMP-021, 022): the run's final stats, one recipient's status, a status by
 * message id, a reply, a STOP, and the drain tick. Public routes (the bridge is not a user); the header `X-Node-Token` must equal
 * `NODE_BRIDGE_TOKEN`, compared in constant time, and with no token configured every call is refused. Not in the API docs.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'campaigns/node', version: '2' })
export class CampaignCallbacksController {
  constructor(
    private readonly callbacks: CampaignCallbacksService,
    private readonly receipts: CampaignReceiptsService,
    private readonly config: ConfigService,
    private readonly runtime: PacingRuntime,
    @Optional() private readonly sweeper?: CampaignSweeper,
  ) {}

  private auth(given: string | undefined): void {
    const expected = this.config.get<string>('NODE_BRIDGE_TOKEN') ?? '';
    const a = Buffer.from(expected);
    const b = Buffer.from(given ?? '');
    if (expected === '' || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException({ ok: false, message: 'forbidden' });
    }
  }

  private found(ok: boolean) {
    if (!ok) throw new NotFoundException({ ok: false, message: 'campaign not found' });
    return { ok: true };
  }

  @Post('update-status')
  @HttpCode(HttpStatus.OK)
  async status(
    @Headers('x-node-token') token: string | undefined,
    @Body(zodPipe(campaignStatus)) body: z.infer<typeof campaignStatus>,
  ) {
    this.auth(token);
    return this.found(await this.callbacks.campaignStatus(body));
  }

  @Post('update-contact-status')
  @HttpCode(HttpStatus.OK)
  async contact(
    @Headers('x-node-token') token: string | undefined,
    @Body(zodPipe(contactStatus)) body: z.infer<typeof contactStatus>,
  ) {
    this.auth(token);
    return this.found(await this.callbacks.contactStatus(body));
  }

  /** Not a campaign message (a broadcast or a chat reply that went through the same listener) is a quiet `matched: false`. */
  @Post('update-status-by-id')
  @HttpCode(HttpStatus.OK)
  async byMessageId(
    @Headers('x-node-token') token: string | undefined,
    @Body(zodPipe(byId)) body: z.infer<typeof byId>,
  ) {
    this.auth(token);
    const receipt: DeliveryReceipt = {
      providerMessageId: body.messageId,
      status: body.status === 'queued' || body.status === 'pending' ? 'sent' : body.status,
      occurredAt: body.timestamp ?? this.runtime.now(),
    };
    // A queued or pending report says nothing a recipient has not already moved past.
    if (body.status === 'queued' || body.status === 'pending') return { ok: true, matched: false };
    return { ok: true, matched: await this.receipts.handle(receipt) };
  }

  @Post('track-response')
  @HttpCode(HttpStatus.OK)
  async reply(
    @Headers('x-node-token') token: string | undefined,
    @Body(zodPipe(response)) body: z.infer<typeof response>,
  ) {
    this.auth(token);
    return this.found(await this.callbacks.trackResponse(body));
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  async stop(
    @Headers('x-node-token') token: string | undefined,
    @Body(zodPipe(unsubscribe)) body: z.infer<typeof unsubscribe>,
  ) {
    this.auth(token);
    return this.found(await this.callbacks.unsubscribe(body));
  }

  /** The bridge's tick. In the API process there is no sweeper (the worker runs it): the answer says nothing is active. */
  @Post('drain')
  @HttpCode(HttpStatus.OK)
  async drain(@Headers('x-node-token') token: string | undefined) {
    this.auth(token);
    const fired = this.sweeper ? await this.sweeper.sweep() : 0;
    return { ok: true, campaigns_fired: fired, campaigns_active: fired > 0 };
  }
}
