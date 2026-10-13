import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SAVED_REPLY_IMPORT_MAX_BYTES } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { Throttle } from '../../platform-infrastructure';
import {
  SavedRepliesTransferService,
  parseImportOptions,
  type UploadedFile as UploadedCsv,
} from './saved-replies-transfer.service';

const upload = FileInterceptor('file', {
  limits: { fileSize: SAVED_REPLY_IMPORT_MAX_BYTES, files: 1 },
});
const UTF8_BOM = String.fromCharCode(0xfeff);

/**
 * CSV import and export of the shared saved replies (BL-107). Registered BEFORE `SavedRepliesController` so `export` and `import` are
 * never read as a reply id. Both need `inbox.savedreply.manage`.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox/saved-replies', version: '2' })
export class SavedRepliesTransferController {
  constructor(private readonly transfer: SavedRepliesTransferService) {}

  @Get('export')
  @RequirePermission('inbox.savedreply.manage')
  @Throttle({ limit: 10, windowSeconds: 60, by: 'actor' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="saved-replies.csv"')
  @ApiOperation({
    summary: 'The shared replies as CSV (title, shortcut, body, category, language, channel)',
    description: 'Formula-safe cells. Personal replies are not exported.',
  })
  async export(): Promise<string> {
    return UTF8_BOM + (await this.transfer.exportCsv());
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.savedreply.manage')
  @Throttle({ limit: 10, windowSeconds: 60, by: 'actor' })
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import shared replies from a CSV (dry run first)',
    description:
      'Form fields: `file`, and `options` (JSON: `duplicatePolicy` skip or overwrite, `dryRun`). Each row is checked on its own and reported; the plan limit is respected.',
  })
  async import(@UploadedFile() file: UploadedCsv | undefined, @Body() body: { options?: string }) {
    return this.transfer.import(file, parseImportOptions(body?.options));
  }
}
