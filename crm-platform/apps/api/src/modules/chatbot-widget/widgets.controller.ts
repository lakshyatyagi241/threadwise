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
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { WidgetsService } from './widgets.service';

/**
 * The website chatbot widgets of the workspace (WD-WGT-001, 006, 023 to 026). The public side (embed script, chat page,
 * visitor endpoints) is a separate controller: it has no sign-in and its own error shape.
 */
@ApiTags('widgets')
@ActorKinds('user')
@Controller({ path: 'widgets', version: '2' })
export class WidgetsController {
  constructor(private readonly widgets: WidgetsService) {}

  @Get()
  @RequirePermission('wgt.widgets.read')
  @ApiOperation({
    summary: 'List widgets (newest first) with the workspace stat numbers',
    description:
      'Cursor pages of 20 by default, `status` filters by active or paused. `stats` ignores the filter. `planLocked` is true ' +
      'when the plan lacks the feature: reads still work, every change is refused with 422 PLAN_FEATURE_LOCKED.',
  })
  list(@Query() query: unknown) {
    return this.widgets.list(query);
  }

  @Get('assistants')
  @RequirePermission('wgt.widgets.read')
  @ApiOperation({ summary: 'The active smart agents the builder offers, by name' })
  assistants() {
    return this.widgets.assistantPicker();
  }

  @Get(':id')
  @RequirePermission('wgt.widgets.read')
  @ApiOperation({ summary: 'One widget, as the builder edits it' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.widgets.get(id);
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('wgt.widgets.create')
  @ApiOperation({
    summary: 'Create a widget: mints the embed token and a workspace-unique slug',
    description:
      'Mode `ai` or `both` needs `assistantId` (422 WGT_ASSISTANT_REQUIRED) of this workspace (422 WGT_ASSISTANT_NOT_IN_WORKSPACE). ' +
      '`allowedDomains` is normalised (trimmed, lower-cased, scheme and path stripped, de-duplicated).',
  })
  create(@Body() body: unknown) {
    return this.widgets.create(body);
  }

  @Patch(':id')
  @RequirePermission('wgt.widgets.update')
  @ApiOperation({
    summary: 'Save a widget (the whole form plus the row version it was read at)',
    description:
      'A stale `rowVersion` is refused with 409 ROW_VERSION_CONFLICT. An unknown id is 404, never a new widget.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.widgets.update(id, body);
  }

  @Patch(':id/status')
  @RequirePermission('wgt.widgets.update')
  @ApiOperation({
    summary: 'Pause or resume a widget; a paused widget stops loading on the sites that embed it',
  })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.widgets.setStatus(id, body);
  }

  @Post(':id/duplicate')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('wgt.widgets.create')
  @ApiOperation({ summary: 'Copy a widget under a fresh token, named "<name> (copy)"' })
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.widgets.duplicate(id);
  }

  @Post(':id/rotate-token')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('wgt.widgets.update')
  @ApiOperation({
    summary: "Replace the widget's embed token; the old snippet stops working immediately",
  })
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.widgets.rotateToken(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('wgt.widgets.delete')
  @ApiOperation({
    summary: 'Delete a widget; its snippet stops working, past conversations stay in the inbox',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.widgets.remove(id);
  }
}
