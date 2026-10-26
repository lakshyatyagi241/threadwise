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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createContactFileSchema,
  listContactFilesQuerySchema,
  type CreateContactFileInput,
  type ListContactFilesQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { chatMediaConfig } from '../../../infra/providers/chat-conversations/media';
import { ContactFilesService, type UploadedContactFile } from './contact-files.service';

const upload = FileInterceptor('file', {
  limits: { fileSize: Math.max(...Object.values(chatMediaConfig().maxBytes)), files: 1 },
});

/**
 * Contact detail page: Files tab. Upload (`POST .../files/upload`) stores the bytes through the chat media door and records them;
 * recording a file that is already stored elsewhere (`POST .../files`) is kept for callers that have the key.
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

  @Post('upload')
  @Idempotent()
  @RequirePermission('record.contacts.update')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a file to a contact',
    description:
      'Multipart field `file`. Checked by content (type, size, magic bytes); the size and type recorded are the ones the server reads.',
  })
  async uploadFile(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @UploadedFile() file: UploadedContactFile | undefined,
  ) {
    return this.files.upload(contactId, file);
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
