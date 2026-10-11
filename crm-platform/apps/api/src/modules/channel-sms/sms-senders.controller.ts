import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  connectSmsSenderSchema,
  lookupSmsNumberSchema,
  toggleSmsSenderSchema,
  type ConnectSmsSenderInput,
  type LookupSmsNumberInput,
  type ToggleSmsSenderInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { Throttle } from '../platform-infrastructure';
import { SmsSendersService } from './sms-senders.service';

/** SMS senders: connect with the provider's keys, list, switch on or off, remove, and check a number (TW-SMS-001 to 008). */
@ApiTags('sms')
@ActorKinds('user')
// The whole channel is the `sms` plan feature, reads included; the delivery-report webhook (a separate public controller) stays open.
@RequirePlanFeature('sms')
@Controller({ path: 'sms', version: '2' })
export class SmsSendersController {
  constructor(private readonly senders: SmsSendersService) {}

  @Get('senders')
  @RequirePermission('sms.senders.read')
  @ApiOperation({ summary: "The workspace's SMS senders, oldest first (never any key)" })
  list() {
    return this.senders.list();
  }

  @Post('senders')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('sms.senders.manage')
  @ApiOperation({
    summary: 'Verify the provider keys, then connect an SMS sender',
    description:
      '422 SMS_CREDENTIALS_REJECTED when the provider refuses the keys (nothing is saved). The same From value updates its sender. ' +
      "Twilio: blank `accountSid` / `authToken` reuse the keys of the workspace's Twilio WhatsApp connection. MSG91: the key is `authToken`.",
  })
  connect(@Body(zodPipe(connectSmsSenderSchema)) body: ConnectSmsSenderInput) {
    return this.senders.connect(body);
  }

  @Patch('senders/:id')
  @Idempotent()
  @RequirePermission('sms.senders.manage')
  @ApiOperation({
    summary: 'Activate or deactivate a sender (keys are kept); 409 ROW_VERSION_CONFLICT when stale',
  })
  toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(toggleSmsSenderSchema)) body: ToggleSmsSenderInput,
  ) {
    return this.senders.toggle(id, body);
  }

  @Delete('senders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('sms.senders.manage')
  @ApiOperation({ summary: 'Remove a sender and its keys (an unknown id changes nothing)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.senders.remove(id);
  }

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  // Every miss is a billed Twilio call.
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @RequirePermission('sms.senders.read')
  @ApiOperation({
    summary:
      'Is this number a mobile, a landline or invalid (Twilio Lookup)? Always 200 with a sentence',
  })
  lookup(@Body(zodPipe(lookupSmsNumberSchema)) body: LookupSmsNumberInput) {
    return this.senders.lookup(body);
  }
}
