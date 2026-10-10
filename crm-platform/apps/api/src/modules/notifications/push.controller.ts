import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  pushMobileInputSchema,
  pushSubscriptionInputSchema,
  type PushMobileInput,
  type PushSubscriptionInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * The signed-in user's browser notification (Web Push) devices. No permission key, like the bell: a person manages only their own, and
 * the service pins every query to them. No response ever carries a subscription endpoint or key.
 */
@ApiTags('notifications')
@ActorKinds('user')
@Controller({ path: 'notifications/push', version: '2' })
export class PushController {
  constructor(private readonly push: PushSubscriptionsService) {}

  @Get('public-key')
  @ApiOperation({
    summary: 'The VAPID public key a browser subscribes with',
    description:
      '`enabled: false` and a null key when the deployment has no VAPID keys: the feature is then off and the web app hides it.',
  })
  publicKey() {
    return this.push.publicKey();
  }

  @Get('subscriptions')
  @ApiOperation({
    summary: 'My browser notification devices',
    description: 'id, label, createdAt and lastUsedAt only. Never the endpoint or the keys.',
  })
  async list() {
    return this.push.list();
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add this browser as a notification device (idempotent per browser)',
    description:
      'Body: PushSubscription.toJSON(). The same browser again refreshes its keys and returns the same device. At most 10 devices per person: the least recently used beyond that are dropped. 404 when the deployment has no VAPID keys.',
  })
  async subscribe(
    @Body(zodPipe(pushSubscriptionInputSchema)) body: PushSubscriptionInput,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.push.subscribe(body, userAgent);
  }

  @Post('mobile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add the native app (Expo push token) as a notification device',
    description:
      'Body: `{ token, platform }`. Idempotent per token. Works without VAPID keys: native pushes go through the Expo push service.',
  })
  async subscribeMobile(@Body(zodPipe(pushMobileInputSchema)) body: PushMobileInput) {
    return this.push.subscribeMobile(body);
  }

  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove one of my browser notification devices',
    description: "Someone else's device, or an unknown id, is 404.",
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.push.remove(id);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a test notification to all my devices',
    description:
      'Ignores preferences and whether a tab is open. Returns how many devices accepted it. One test per person every 10 seconds (429 otherwise).',
  })
  async test() {
    return this.push.test();
  }
}
