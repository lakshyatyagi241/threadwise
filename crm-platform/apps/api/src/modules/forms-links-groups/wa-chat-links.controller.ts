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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  saveWaChatLinkInputSchema,
  waChatLinkListQuerySchema,
  type SaveWaChatLinkInput,
  type WaChatLinkListQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { WaChatLinksService } from './wa-chat-links.service';

/**
 * WhatsApp Link Generator (WFL; Reference `/wa-links`; docs/threadwise-port/inventory/forms-links-groups.md TW-WFL-012..018).
 * Same plan feature as Forms (`forms_and_links`). Engine-agnostic, unlike Forms.
 */
@ApiTags('whatsapp-links')
@ActorKinds('user')
@RequirePlanFeature('forms_and_links')
@Controller({ path: 'wa-links', version: '2' })
export class WaChatLinksController {
  constructor(private readonly links: WaChatLinksService) {}

  @Get()
  @RequirePermission('wfl.links.read')
  @ApiOperation({ summary: 'Links of the workspace, newest first, with the KPI counters' })
  list(@Query(zodPipe(waChatLinkListQuerySchema)) query: WaChatLinkListQuery) {
    return this.links.list(query);
  }

  @Get(':id')
  @RequirePermission('wfl.links.read')
  @ApiOperation({ summary: 'One link' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.get(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('wfl.links.create')
  @ApiOperation({ summary: 'Mint a link' })
  create(@Body(zodPipe(saveWaChatLinkInputSchema)) body: SaveWaChatLinkInput) {
    return this.links.create(body);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('wfl.links.manage')
  @ApiOperation({ summary: 'Save a link' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(saveWaChatLinkInputSchema)) body: SaveWaChatLinkInput,
  ) {
    return this.links.update(id, body);
  }

  @Post(':id/duplicate')
  @Idempotent()
  @RequirePermission('wfl.links.create')
  @ApiOperation({ summary: 'Duplicate a link with a fresh slug' })
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.duplicate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  @RequirePermission('wfl.links.delete')
  @ApiOperation({ summary: 'Delete a link' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.links.remove(id);
  }
}
