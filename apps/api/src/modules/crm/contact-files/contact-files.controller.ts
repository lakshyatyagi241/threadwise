import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createContactFileSchema,
  listContactFilesQuerySchema,
  type CreateContactFileInput,
  type ListContactFilesQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactFilesService } from './contact-files.service';

/**
 * Contact detail page: Files tab. Metadata only — actual byte upload is
 * Phase 9 (File Manager)'s job; this records where a file ended up.
 * Gated behind record.contacts.* (not its own permission set).
 */
@ApiTags('contact-files')
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/files', version: '2' })
export class ContactFilesController {
  constructor(private readonly files: ContactFilesService) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: "List a contact's files" })
  async list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(listContactFilesQuerySchema)) query: ListContactFilesQuery,
  ) {
    return this.files.list(contactId, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Record a file already uploaded elsewhere',
    description: 'storageKey is caller-supplied — this endpoint does not accept file bytes.',
  })
  async create(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(zodPipe(createContactFileSchema)) body: CreateContactFileInput,
  ) {
    return this.files.create(contactId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contacts.update')
  @ApiOperation({ summary: 'Delete a file record' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.files.remove(id);
  }
}
