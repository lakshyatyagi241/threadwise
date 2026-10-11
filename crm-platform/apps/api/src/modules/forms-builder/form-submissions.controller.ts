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
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  exportFormSubmissionsSchema,
  listFormSubmissionsQuerySchema,
  type ExportFormSubmissionsInput,
  type ListFormSubmissionsQuery,
  type RecordScope,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { FormSubmissionsService } from './form-submissions.service';

/**
 * Submissions of a form (docs/specs/forms-builder-app.md 7.1). Same plan gate as the forms; the capabilities are `record.form-submissions.*`
 * and carry a record scope (a submission is visible to whoever may see its form or owns its contact). `export` is a literal path declared
 * before `:sid`.
 */
@ApiTags('forms')
@ActorKinds('user')
@RequirePlanFeature('form_builder')
@Controller({ path: 'forms/:id/submissions', version: '2' })
export class FormSubmissionsController {
  constructor(private readonly submissions: FormSubmissionsService) {}

  @Get()
  @RequirePermission('record.form-submissions.read')
  @ApiOperation({
    summary: 'List the submissions of a form',
    description:
      'Newest first. Filters: status, tab (all, needs_attention, spam), from, to, q (name, email or phone), contactId. The spam tab is its own list: `all` leaves spam out.',
  })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listFormSubmissionsQuerySchema)) query: ListFormSubmissionsQuery,
    @GrantedScope('record.form-submissions.read') scope: RecordScope,
  ) {
    return this.submissions.list(id, query, scope);
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.form-submissions.export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Export submissions to CSV',
    description:
      'text/csv, newest first, at most 10,000 rows (`X-Export-Truncated: true` says when it was cut). One column per field; cells starting with = + - @ are prefixed so a spreadsheet does not run them as formulas. Audited.',
  })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(exportFormSubmissionsSchema)) body: ExportFormSubmissionsInput,
    @GrantedScope('record.form-submissions.export') scope: RecordScope,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.submissions.export(id, body, scope);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('X-Export-Truncated', out.truncated ? 'true' : 'false');
    res.setHeader('X-Export-Rows', String(out.rows));
    return out.csv;
  }

  @Get(':sid')
  @RequirePermission('record.form-submissions.read')
  @ApiOperation({ summary: 'One submission with its answers (opening answers is audited)' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @GrantedScope('record.form-submissions.read') scope: RecordScope,
  ) {
    return this.submissions.get(id, sid, scope);
  }

  @Post(':sid/retry')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.form-submissions.update')
  @ApiOperation({
    summary: "Run a submission again under the form's current mapping",
    description:
      'For a submission that needs review, failed, or was held as spam ("not spam"). 409 FORMS_SUBMISSION_NOT_RETRYABLE for any other, 410 FORMS_SUBMISSION_PURGED when its answers were removed.',
  })
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @GrantedScope('record.form-submissions.update') scope: RecordScope,
  ) {
    return this.submissions.retry(id, sid, scope);
  }

  @Post(':sid/payment-link')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.form-submissions.update')
  @ApiOperation({
    summary: 'A fresh payment link for a submission awaiting payment',
    description:
      'Opens a new attempt (the amount is worked out again from the version the visitor saw) and returns the hosted link; `url` is null when the gateway refused. 409 FORMS_PAYMENT_STATE for a submission with nothing to pay, 422 FORMS_PAYMENT_UNAVAILABLE without a usable gateway.',
  })
  paymentLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @GrantedScope('record.form-submissions.update') scope: RecordScope,
  ) {
    return this.submissions.newPaymentLink(id, sid, scope);
  }

  @Post(':sid/mark-paid')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.form-submissions.update')
  @ApiOperation({
    summary: 'Mark a submission as paid (money that arrived outside the gateway)',
    description:
      'An audited staff action for a bank transfer or cash. 409 FORMS_PAYMENT_STATE unless the submission is awaiting payment.',
  })
  markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @GrantedScope('record.form-submissions.update') scope: RecordScope,
  ) {
    return this.submissions.markPaid(id, sid, scope);
  }

  @Delete(':sid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.form-submissions.delete')
  @ApiOperation({
    summary: 'Erase the answers of a submission (GDPR)',
    description:
      'The answers and what identifies the visitor are removed; the row stays as a tombstone with its outcome and consent evidence. The contact is never touched.',
  })
  async erase(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @GrantedScope('record.form-submissions.delete') scope: RecordScope,
  ) {
    await this.submissions.erase(id, sid, scope);
  }
}
