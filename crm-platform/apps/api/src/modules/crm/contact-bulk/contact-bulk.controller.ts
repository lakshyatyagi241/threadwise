import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bulkDeleteContactsSchema,
  bulkGroupContactsSchema,
  bulkTagContactsSchema,
  exportContactsSchema,
  type BulkDeleteContactsInput,
  type BulkGroupContactsInput,
  type BulkTagContactsInput,
  type ExportContactsInput,
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
