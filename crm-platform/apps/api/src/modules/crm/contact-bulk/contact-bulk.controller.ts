import {
  Body,
  Controller,
  Get,
  Header,
  ParseUUIDPipe,
  Param,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bulkDeleteContactsSchema,
  bulkGroupContactsSchema,
  bulkTagContactsSchema,
  exportContactsSchema,
  exportHistoryQuerySchema,
  type BulkDeleteContactsInput,
  type BulkGroupContactsInput,
  type BulkTagContactsInput,
  type ExportContactsInput,
  type ExportHistoryQuery,
  type RecordScope,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactsService } from '../contacts/contacts.service';
import { ContactBulkService } from './contact-bulk.service';

/**
 * Bulk actions and the stat tiles. This controller is registered BEFORE ContactsController in
 * CrmModule: `GET /contacts/stats` is a literal one-segment route and would otherwise be
 * swallowed by `GET /contacts/:id` (Express matches in registration order).
 */
@ApiTags('contacts')
@ActorKinds('user')
@Controller({ path: 'contacts', version: '2' })
export class ContactBulkController {
  constructor(
    private readonly bulk: ContactBulkService,
    private readonly contacts: ContactsService,
  ) {}

  @Get('stats')
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary: 'Workspace-wide contact counts: total, subscribed, unsubscribed, no group, imported',
    description: 'Inside the caller record scope; the active list filter does not change them.',
  })
  async stats(@GrantedScope('record.contacts.read') scope: RecordScope) {
    return this.contacts.stats(scope);
  }

  @Post('bulk/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.delete')
  @ApiOperation({
    summary: 'Bulk-delete contacts (by ids, or everything matching a filter)',
    description:
      'Unknown ids and ids outside the caller scope are listed in `failed`; they do not stop the rest. `changed` is what was actually deleted.',
  })
  async delete(
    @Body(zodPipe(bulkDeleteContactsSchema)) body: BulkDeleteContactsInput,
    @GrantedScope('record.contacts.delete') scope: RecordScope,
  ) {
    return this.bulk.delete(body, scope);
  }

  @Post('bulk/group')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary:
      'Add contacts to a group or remove them from it (ids, or everything matching a filter)',
  })
  async group(
    @Body(zodPipe(bulkGroupContactsSchema)) body: BulkGroupContactsInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.bulk.group(body, scope);
  }

  @Post('bulk/tag')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Tag or untag contacts (ids, or everything matching a filter)',
    description:
      'By tagId or by name. Adding with a name that matches no tag creates it (needs record.tags.create, counts against the plan tag limit); removing never creates.',
  })
  async tag(
    @Body(zodPipe(bulkTagContactsSchema)) body: BulkTagContactsInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.bulk.tag(body, scope);
  }

  @Get('exports')
  @RequirePermission('record.contacts.export')
  @ApiOperation({
    summary: 'Recent exports of contacts: who, when and how many rows',
    description:
      'From the audit trail, each with its saved file (kept 30 days) when the caller may download it.',
  })
  async exports(
    @Query(zodPipe(exportHistoryQuerySchema)) query: ExportHistoryQuery,
    @GrantedScope('record.contacts.export') scope: RecordScope,
  ) {
    return this.bulk.exportHistory(query, scope);
  }

  @Get('exports/:id/download')
  @RequirePermission('record.contacts.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contacts-export.csv"')
  @ApiOperation({
    summary: 'Download a saved export again',
    description:
      'The file of an earlier export while it is kept (30 days). Allowed for the person who exported and for an exporter with scope "all".',
  })
  async downloadExport(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.contacts.export') scope: RecordScope,
  ): Promise<StreamableFile> {
    const { csv } = await this.bulk.downloadExport(id, scope);
    return new StreamableFile(csv);
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contacts-export.csv"')
  @ApiOperation({
    summary: 'Export contacts as CSV (ids, or everything matching a filter)',
    description: 'Streams the file. At most 200,000 rows per call: narrow the filter beyond that.',
  })
  async export(
    @Body(zodPipe(exportContactsSchema)) body: ExportContactsInput,
    @GrantedScope('record.contacts.export') scope: RecordScope,
  ): Promise<StreamableFile> {
    const { stream } = await this.bulk.export(body, scope);
    return new StreamableFile(stream);
  }
}
