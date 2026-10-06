import {
  Body,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation } from '@nestjs/swagger';
import {
  v1ListMessagesQuerySchema,
  v1SendMessageSchema,
  type V1ListMessagesQuery,
  type V1SendMessageInput,
} from '@crm/contracts';
import { Idempotent } from '../../../../common/decorators';
import { zodPipe } from '../../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../../plans-subscriptions-trials';
import { RequireApiScope } from '../../auth/api-scope';
import { V1Controller } from '../../http/v1-controller.decorator';
import { ok } from '../../http/v1-envelope';
import { MessageSendService } from './message-send.service';
import { MessagingReadService } from './messaging-read.service';
import { UuidParam } from './uuid-param.pipe';
import type { UploadedFile as UploadedFileShape } from './media-intake.service';
import { v1FileUpload } from './v1-file-upload';

/** Messages: send one (TW-API-110), the history (111) and one message's status (112). */
@V1Controller('messages')
@RequirePlanFeature('public_api')
export class V1MessagesController {
  constructor(
    private readonly sender: MessageSendService,
    private readonly reads: MessagingReadService,
  ) {}

  @Post()
  @HttpCode(201)
  @Idempotent()
  @RequireApiScope('messages:write')
  @UseInterceptors(v1FileUpload('media'))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({
    summary: 'Send one WhatsApp message (text, image, video, document, audio or location)',
    description:
      'JSON, or multipart to attach a file in `media`. Answers 201 with the message and its status; the id is the one to poll with `GET /messages/{id}`.',
  })
  async send(
    @Body(zodPipe(v1SendMessageSchema)) body: V1SendMessageInput,
    @UploadedFile() media: UploadedFileShape | undefined,
  ) {
    return ok(await this.sender.send(body, media));
  }

  @Get()
  @RequireApiScope('messages:read')
  @ApiOperation({ summary: 'The most recent messages of the workspace, newest first' })
  list(@Query(zodPipe(v1ListMessagesQuerySchema)) query: V1ListMessagesQuery) {
    return this.reads.listMessages(query);
  }

  @Get(':id')
  @RequireApiScope('messages:read')
  @ApiOperation({
    summary: 'One message with its delivery status (pending, sent, delivered, read or failed)',
  })
  async get(@Param('id', new UuidParam('Message')) id: string) {
    return ok(await this.reads.getMessage(id));
  }
}
