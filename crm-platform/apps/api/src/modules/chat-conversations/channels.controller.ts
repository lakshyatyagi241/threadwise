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
  updateChannelSchema,
  type CreateChannelInput,
  type CreateSimulatorChannelInput,
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
