import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { pickChatLocale } from './chat-page-text';
import { WidgetsService } from './widgets.service';

/**
 * The widget a website chat bot owns: its look (the Customize tab) and, once saved, its embed address (the Install tab).
 * It lives under the flow because a bot is built for one channel and has at most one widget.
 */
@ApiTags('widgets')
@ActorKinds('user')
@Controller({ path: 'flows/:flowId/widget', version: '2' })
export class FlowWidgetController {
  constructor(private readonly widgets: WidgetsService) {}

  @Get()
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: "A website chat bot's widget",
    description:
      '`widget` is null until the owner has saved Customize once, which is what keeps the "needs customizing" reminder on. 422 when the bot is not a website chat bot.',
  })
  get(@Param('flowId', ParseUUIDPipe) flowId: string) {
    return this.widgets.getForFlow(flowId);
  }

  @Get('preview-page')
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: 'The chat window as the Customize tab previews it',
    description:
      'The real chat page in preview mode: it draws the settings its parent sends it and a short sample conversation, with no network and no visitor. 422 when the bot is not a website chat bot.',
  })
  previewPage(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Headers('accept-language') acceptLanguage: string | undefined,
  ) {
    return this.widgets.previewPage(flowId, pickChatLocale(acceptLanguage));
  }

  @Post('preview-embed')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: 'The closed launcher as the Customize tab previews it',
    description:
      'A stand-in page running the real loader (callout, animation, unread dot) for the launcher settings in the body. Nothing is stored. 422 when the bot is not a website chat bot.',
  })
  previewEmbed(@Param('flowId', ParseUUIDPipe) flowId: string, @Body() body: unknown) {
    return this.widgets.previewEmbed(flowId, body);
  }

  @Put()
  @Idempotent()
  @RequirePermission('flb.flows.update')
  @ApiOperation({
    summary: "Save a website chat bot's widget look",
    description:
      'The first save creates the widget and counts as the first customization. Later saves send the `rowVersion` they were read at (409 ROW_VERSION_CONFLICT when stale).',
  })
  save(@Param('flowId', ParseUUIDPipe) flowId: string, @Body() body: unknown) {
    return this.widgets.saveForFlow(flowId, body);
  }

  @Post('assets/:slot')
  @RequirePermission('flb.flows.update')
  @ApiConsumes('multipart/form-data')
  // A little above the 1 MB cap so a file just over it still reaches the upload policy and gets its precise message.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_300_000 } }))
  @ApiOperation({
    summary: "Upload a picture for a WhatsApp bot's button (`logo` or `popup`)",
    description:
      'Multipart field `file`: a PNG, JPG, WebP or GIF up to 1 MB. Returns the public address to put in the button settings.',
  })
  upload(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('slot') slot: string,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
  ) {
    return this.widgets.uploadAsset(flowId, slot, file);
  }

  @Delete('assets/:slot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('flb.flows.update')
  @ApiOperation({ summary: "Remove a picture of a WhatsApp bot's button" })
  async removeUpload(
    @Param('flowId', ParseUUIDPipe) flowId: string,
    @Param('slot') slot: string,
  ): Promise<void> {
    await this.widgets.removeAsset(flowId, slot);
  }
}
