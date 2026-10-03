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
  createSimulatorChannelSchema,
  updateChannelSchema,
  type CreateSimulatorChannelInput,
  type UpdateChannelInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ChannelRegistryService } from './channel-registry.service';

/**
 * The channel registry. Reading needs only the right to read conversations (the inbox shows which channels exist); editing and
 * removing need `inbox.channel.manage`. No response ever carries a credential.
 *
 * WhatsApp numbers are not created here: they are connected under WhatsApp numbers (the WABA domain), which also owns their token and
 * their webhook, and each one appears in this list as a channel on its own.
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
  @ApiOperation({ summary: 'Rename, switch on or off, change settings' })
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
      "Reads the number (name, quality, messaging limit, status), the account and the webhook subscription from the provider with the connected number's credentials, stores the snapshot on the channel and answers with it. A refused token moves the channel to `needs_reauth`; a passing check on a linked number brings it back. A failed check is an answer with `ok: false`, not an error.",
  })
  async health(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.checkHealth(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({ summary: 'Remove a channel with no conversations' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.channels.remove(id);
  }
}
