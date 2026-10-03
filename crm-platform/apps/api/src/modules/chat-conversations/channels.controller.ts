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
  createChannelSchema,
  createSimulatorChannelSchema,
  subscribeChannelSchema,
  updateChannelSchema,
  type CreateChannelInput,
  type CreateSimulatorChannelInput,
  type SubscribeChannelInput,
  type UpdateChannelInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ChannelRegistryService } from './channel-registry.service';

/**
 * The channel registry. Reading needs only the right to read conversations (the inbox shows which channels exist); connecting,
 * editing and removing need `inbox.channel.manage`. No response ever carries a credential: `credentialHints` is the last four
 * characters of each secret and `webhookVerifyToken` appears once, on create and on rotate.
 *
 * `create` and `rotate` are not `@Idempotent`: the idempotency store would keep their response, which holds the one-time token.
 */
@ApiTags('channels')
@ActorKinds('user')
@Controller({ path: 'channels', version: '2' })
export class ChannelsController {
  constructor(private readonly channels: ChannelRegistryService) {}

  @Get()
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({ summary: 'Connected channels with their capabilities (no secrets)' })
  async list() {
    return this.channels.list();
  }

  @Post()
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({
    summary: 'Connect a provider account',
    description:
      'Credentials are sealed at rest. The channel is stored `disconnected` until its adapter can send. The response carries the webhook verify token once.',
  })
  async create(@Body(zodPipe(createChannelSchema)) body: CreateChannelInput) {
    return this.channels.create(body);
  }

  // Literal path before the `:id` routes that share its first segment.
  @Post('simulator')
  @Idempotent()
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({ summary: 'Create the dev-only simulated channel (flag on, never in production)' })
  async createSimulator(
    @Body(zodPipe(createSimulatorChannelSchema)) body: CreateSimulatorChannelInput,
  ) {
    return this.channels.createSimulator(body);
  }

  @Get('requirements/:kind')
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({
    summary: 'What a connection of this kind needs in this workspace',
    description:
      "Which credential keys the connection form must ask for: the customer's own token (`channel_token`) or only the number and account ids because the platform's provider credential does the sending (`platform_token`).",
  })
  async requirements(@Param('kind') kind: string) {
    return this.channels.requirements(kind);
  }

  @Get(':id')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({ summary: 'One channel' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.get(id);
  }

  @Patch(':id')
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({ summary: 'Rename, switch on or off, change settings, rotate credentials' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateChannelSchema)) body: UpdateChannelInput,
  ) {
    return this.channels.update(id, body);
  }

  @Post(':id/health')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({
    summary: 'Live health check of the provider account',
    description:
      'Reads the number (name, quality, messaging limit, status), the account and the webhook subscription from the provider with the stored credentials, stores the snapshot on the channel and answers with it. A refused token moves the channel to `needs_reauth`. A failed check is an answer with `ok: false`, not an error.',
  })
  async health(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.checkHealth(id);
  }

  @Post(':id/subscribe')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({
    summary: "Point the provider's webhooks for this channel at this platform",
    description:
      'Subscribes the app to the account or, where the provider needs it (always for a BSP proxy), overrides the callback URL and verify token per number. An override issues a new verify token, shown once in the answer.',
  })
  async subscribe(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(subscribeChannelSchema)) body: SubscribeChannelInput,
  ) {
    return this.channels.configureWebhook(id, body);
  }

  @Post(':id/webhook-token')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({
    summary: 'Issue a new webhook verify token (shown once); the old one stops working',
  })
  async rotateWebhookToken(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.rotateWebhookToken(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({ summary: 'Remove a channel with no conversations' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.channels.remove(id);
  }
}
