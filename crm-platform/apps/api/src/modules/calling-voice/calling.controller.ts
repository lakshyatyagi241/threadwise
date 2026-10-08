import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream';
import {
  CALL_RECORDING_MAX_BYTES,
  acceptCallInputSchema,
  callEligibilityQuerySchema,
  dialInputSchema,
  rejectCallInputSchema,
  requestPermissionInputSchema,
  toggleCallingInputSchema,
  type AcceptCallInput,
  type CallEligibilityQuery,
  type DialInput,
  type RejectCallInput,
  type RequestPermissionInput,
  type ToggleCallingInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { MediaRangeError } from '../../infra/providers/chat-conversations/media';
import { CallActionsService } from './call-actions.service';
import { CallPermissionService } from './call-permission.service';
import { CallRecordingsService } from './call-recordings.service';
import { CallingNumbersService } from './calling-numbers.service';

/** `bytes=500-` and `bytes=500-999`; anything else is answered with the whole file. */
function parseRange(header: string | undefined): { start: number; end?: number } | undefined {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header ?? '');
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] === '' ? undefined : Number(m[2]);
  return end !== undefined && end < start ? undefined : { start, end };
}

/**
 * WhatsApp calling from the inbox (CALL, TW-CALL-003 to 016, 019). Placing, answering and reading calls need `call.calls.use`; switching
 * calling on a number needs `call.calling.manage` (Reference: the workspace role manager for both). The plan feature `waba_calling`
 * gates every route (in the services, not by decorator, so one rule covers the worker paths too). The plan feature `calling` is Reference's
 * `access_calling` flag, the AI voice agent: a different product from WhatsApp calling, it has no routes in this tree and is not checked here, so no route carries
 * two conflicting keys. Ids are uuids in the caller's workspace, so another workspace's id is a 404.
 */
@ApiTags('calling')
@ActorKinds('user')
@Controller({ path: 'calling', version: '2' })
export class CallingController {
  constructor(
    private readonly numbers: CallingNumbersService,
    private readonly permissions: CallPermissionService,
    private readonly actions: CallActionsService,
    private readonly recordings: CallRecordingsService,
  ) {}

  @Get('numbers')
  @RequirePermission('call.calls.use')
  @ApiOperation({ summary: 'The WhatsApp numbers with their calling switch' })
  list() {
    return this.numbers.list();
  }

  @Post('numbers/:id/toggle')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('call.calling.manage')
  @ApiOperation({
    summary: 'Switch calling on or off for a number',
    description:
      "Meta's own setting; the local flags change only after Meta accepts. 422 CALL_COEXISTENCE_UNSUPPORTED, CALL_META_REFUSED (in words).",
  })
  toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(toggleCallingInputSchema)) body: ToggleCallingInput,
  ) {
    return this.numbers.toggle(id, body.enable);
  }

  @Get('eligibility')
  @RequirePermission('call.calls.use')
  @ApiOperation({
    summary:
      'Whether the Call button shows for a conversation, and whether the customer allowed calls',
  })
  eligibility(@Query(zodPipe(callEligibilityQuerySchema)) q: CallEligibilityQuery) {
    return this.numbers.eligibility(q.conversationId);
  }

  @Post('permission-request')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('call.calls.use')
  @ApiOperation({ summary: 'Ask the customer for permission to call them' })
  requestPermission(@Body(zodPipe(requestPermissionInputSchema)) body: RequestPermissionInput) {
    return this.permissions.request(body.numberId, body.to, body.body);
  }

  @Post('calls/dial')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('call.calls.use')
  @ApiOperation({
    summary: 'Place a call',
    description:
      'Permission first: with no usable grant a request is sent instead and the answer is 422 CALL_PERMISSION_REQUESTED. Opus-only SDP offer.',
  })
  dial(@Body(zodPipe(dialInputSchema)) body: DialInput) {
    return this.actions.dial(body);
  }

  @Get('calls/pending')
  @RequirePermission('call.calls.use')
  @ApiOperation({ summary: 'Calls ringing now (inbound, last two minutes)' })
  pending() {
    return this.actions.pending();
  }

  @Get('calls/:id/progress')
  @RequirePermission('call.calls.use')
  @ApiOperation({ summary: "Has the customer picked up? Meta's SDP answer once they have" })
  progress(@Param('id', ParseUUIDPipe) id: string) {
    return this.actions.progress(id);
  }

  @Post('calls/:id/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('call.calls.use')
  @ApiOperation({
    summary: 'Answer a ringing call (409 CALL_STATE_CONFLICT when a teammate took it first)',
  })
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(acceptCallInputSchema)) body: AcceptCallInput,
  ): Promise<void> {
    await this.actions.accept(id, body.sdpAnswer);
  }

  @Post('calls/:id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('call.calls.use')
  @ApiOperation({ summary: 'Decline a ringing call' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rejectCallInputSchema)) body: RejectCallInput,
  ): Promise<void> {
    await this.actions.reject(id, body.reason);
  }

  @Post('calls/:id/terminate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('call.calls.use')
  @ApiOperation({ summary: 'Hang up (or cancel a call still ringing)' })
  async terminate(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.actions.terminate(id);
  }

  @Post('calls/:id/recording')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('call.calls.use')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('recording', { limits: { fileSize: CALL_RECORDING_MAX_BYTES, files: 1 } }),
  )
  @ApiOperation({ summary: "Upload the operator's recording of a call (up to 50 MB)" })
  uploadRecording(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
  ) {
    return this.recordings.store(id, file ?? { buffer: Buffer.alloc(0) });
  }

  @Get('calls/:id/recording')
  @RequirePermission('call.calls.use')
  @ApiOperation({ summary: 'The recording of a call' })
  async recording(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    let opened;
    try {
      opened = await this.recordings.open(id, parseRange(req.header('range')));
    } catch (err) {
      if (err instanceof MediaRangeError) {
        res.status(416).setHeader('Content-Range', `bytes */${err.size}`).end();
        return;
      }
      throw err;
    }
    if (!opened) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'This call has no recording.' });
      return;
    }
    const { media, mime, name } = opened;
    res.status(media.partial ? 206 : 200);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(media.end - media.start + 1));
    res.setHeader('Accept-Ranges', 'bytes');
    if (media.partial)
      res.setHeader('Content-Range', `bytes ${media.start}-${media.end}/${media.size}`);
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    pipeline(media.stream, res, () => undefined);
  }
}
