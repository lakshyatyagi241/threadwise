import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  saveWaFormInputSchema,
  waFormListQuerySchema,
  waFormSubmissionListQuerySchema,
  type SaveWaFormInput,
  type WaFormListQuery,
  type WaFormSubmissionListQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { WaFormsService } from './wa-forms.service';

/**
 * WhatsApp Forms (WFL; Reference `/wa-forms`; docs/wadesk-port/inventory/forms-links-groups.md WD-WFL-001..010). Plan
 * feature `forms_and_links` gates every route (the existing registry key for Reference's WhatsApp Flows forms — on
 * by default, shared with the Link Generator; NOT `form_builder`, which is the unrelated web-forms Marketplace
 * app). `picker` is a literal path declared before `:id` so it is never captured as an id.
 */
@ApiTags('whatsapp-forms')
@ActorKinds('user')
@RequirePlanFeature('forms_and_links')
@Controller({ path: 'wa-forms', version: '2' })
export class WaFormsController {
  constructor(private readonly forms: WaFormsService) {}

  @Get()
  @RequirePermission('wfl.forms.read')
  @ApiOperation({ summary: 'Forms of the workspace, newest first, with the four KPI counters' })
  list(@Query(zodPipe(waFormListQuerySchema)) query: WaFormListQuery) {
    return this.forms.list(query);
  }

  @Get('picker')
  @RequirePermission('wfl.forms.read')
  @ApiOperation({ summary: "Forms for the flow builder's WhatsApp Form node picker" })
  picker() {
    return this.forms.picker();
  }

  @Get(':id')
  @RequirePermission('wfl.forms.read')
  @ApiOperation({ summary: 'One form' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.forms.get(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('wfl.forms.create')
  @ApiOperation({ summary: 'Create a form (draft)' })
  create(@Body(zodPipe(saveWaFormInputSchema)) body: SaveWaFormInput) {
    return this.forms.create(body);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('wfl.forms.manage')
  @ApiOperation({
    summary: 'Save a form',
    description: 'Editing a published form drops it back to draft (Reference parity).',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(saveWaFormInputSchema)) body: SaveWaFormInput) {
    return this.forms.update(id, body);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wfl.forms.manage')
  @ApiOperation({ summary: 'Publish the form as a Meta WhatsApp Flow' })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.forms.publish(id);
  }

  @Post(':id/duplicate')
  @Idempotent()
  @RequirePermission('wfl.forms.create')
  @ApiOperation({ summary: 'Duplicate a form as a new draft' })
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.forms.duplicate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  @RequirePermission('wfl.forms.delete')
  @ApiOperation({ summary: 'Delete a form' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.forms.remove(id);
  }

  @Get(':id/submissions')
  @RequirePermission('wfl.form-submissions.read')
  @ApiOperation({ summary: 'Submissions of the form, newest first' })
  submissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(waFormSubmissionListQuerySchema)) query: WaFormSubmissionListQuery,
  ) {
    return this.forms.submissions(id, query);
  }

  @Get(':id/submissions/export')
  @RequirePermission('wfl.form-submissions.export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Export submissions as CSV' })
  async exportSubmissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.forms.submissionsCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    return out.csv;
  }
}
