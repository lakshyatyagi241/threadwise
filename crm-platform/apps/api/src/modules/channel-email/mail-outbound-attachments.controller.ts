import {
  Body,
  CallHandler,
  Controller,
  Delete,
  ExecutionContext,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { uploadMailAttachmentFieldsSchema, type UploadMailAttachmentFields } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { attachmentTooLarge } from './mail-outbound-errors';
import {
  MailOutboundAttachments,
  type UploadedMailFile,
} from './mail-outbound-attachments.service';

/** multer stops reading one byte past the cap; its 413 is answered with our error code. The env is read when the app starts. */
const Multipart = FileInterceptor('file', {
  limits: { fileSize: channelEmailEnv().MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES + 1, files: 1 },
});

@Injectable()
class MailUploadInterceptor implements NestInterceptor {
  private readonly inner = new Multipart();

  async intercept(ctx: ExecutionContext, next: CallHandler) {
    try {
      return await this.inner.intercept(ctx, next);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
        throw attachmentTooLarge(channelEmailEnv().MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES);
      }
      throw err;
    }
  }
}

/**
 * Composer uploads (TW-MAIL-027): `POST /v2/email/attachments/upload` stages one file for the reply being written, `DELETE
 * /v2/email/attachments/:id` takes it back. The reply names the ids in `email.attachmentIds`. Reading an attachment of a message is the
 * other controller on this path (`EmailAttachmentsController`).
 */
@ApiTags('email')
@ActorKinds('user')
@RequirePlanFeature('email_channel')
@Controller({ path: 'email/attachments', version: '2' })
export class MailOutboundAttachmentsController {
  constructor(private readonly attachments: MailOutboundAttachments) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inbox.conversation.reply')
  @UseInterceptors(MailUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Stage a file for an email reply',
    description:
      'Multipart field `file` (and optionally `conversationId`). Checked by content, size caps (413 MAIL_ATTACHMENT_TOO_LARGE), the mime allow/deny lists and the antivirus hook. The returned id goes in `email.attachmentIds` of a reply; it is usable once, by the uploader only, and expires after 24 hours.',
  })
  upload(
    @UploadedFile() file: UploadedMailFile | undefined,
    @Body(zodPipe(uploadMailAttachmentFieldsSchema)) fields: UploadMailAttachmentFields,
  ) {
    return this.attachments.upload(file, fields);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.conversation.reply')
  @ApiOperation({
    summary: 'Remove a staged file',
    description: 'Only your own, unsent upload; anything else is a 404.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.attachments.remove(id);
  }
}
