import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { catchError, throwError, type Observable } from 'rxjs';
import {
  ERROR_CODES,
  WA_DEVICE_GROUP_PICTURE_MAX_BYTES,
  changeWaGroupParticipantsInputSchema,
  createWaDeviceGroupBodySchema,
  handleWaDeviceGroupJoinRequestsInputSchema,
  leaveWaDeviceGroupInputSchema,
  removeWaGroupParticipantsInputSchema,
  updateWaDeviceGroupInputSchema,
  waDeviceGroupJoinBodySchema,
  waDeviceGroupJoinPreviewBodySchema,
  waDeviceGroupJoinRequestsQuerySchema,
  waDeviceGroupListByDeviceQuerySchema,
  waDeviceGroupMembersQuerySchema,
  type ChangeWaGroupParticipantsInput,
  type CreateWaDeviceGroupBody,
  type HandleWaDeviceGroupJoinRequestsInput,
  type LeaveWaDeviceGroupInput,
  type UpdateWaDeviceGroupInput,
  type WaDeviceGroupJoinBody,
  type WaDeviceGroupJoinPreviewBody,
  type WaDeviceGroupJoinRequestsQuery,
  type WaDeviceGroupListByDeviceQuery,
  type WaDeviceGroupMembersQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { DeviceGroupsService } from './device-groups.service';
import { UnofficialEngineGuard } from './unofficial-engine.guard';

const removeBodySchema = removeWaGroupParticipantsInputSchema;
type RemoveBody = { numbers: string[] };

/** One picture of at most 5 MB; the byte check (JPEG or PNG) is the service's. A file one byte over the cap still reaches it for a clear 422. */
const pictureUpload = FileInterceptor('file', {
  limits: { fileSize: WA_DEVICE_GROUP_PICTURE_MAX_BYTES, files: 1, fields: 4 },
});

/** The transport's bare 413 for a file over the cap becomes the same 422 the byte check gives (list it BEFORE the file interceptor). */
@Injectable()
class PictureTooLargeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((err: unknown) =>
          throwError(() =>
            err instanceof PayloadTooLargeException
              ? new AppError(
                  ERROR_CODES.VALIDATION_FAILED,
                  'The picture is larger than 5 MB.',
                  HttpStatus.UNPROCESSABLE_ENTITY,
                  [{ path: 'file', message: 'too_large' }],
                )
              : err,
          ),
        ),
      );
  }
}

/**
 * The groups of one personal WhatsApp number (the unofficial engine; the twin of `/v2/waba/numbers/:id/groups`). `:id` is the device's
 * uuid, read through the caller's tenant, so another workspace's device is a 404. Every route first runs the engine gate (422
 * WA_UNOFFICIAL_DISABLED), then needs one of the `wa.groups.*` keys (Owner and Admin hold them by default).
 *
 * Reads come from the directory the worker keeps (no WhatsApp call); changes call WhatsApp through the number's own worker, behind the
 * per-number ban-safety limiter (429 WA_GROUP_RATE_LIMITED with `retryAfterS` and `scope` in `errors[]`). Member numbers, the join-request
 * queue and the invite link only go to `wa.groups.manage`. Literal paths (`state`, `sync`, `join-by-link`) come before `:gid`.
 */
@ApiTags('whatsapp-device-groups')
@ActorKinds('user')
@UseGuards(UnofficialEngineGuard)
@Controller({ path: 'devices/:id/groups', version: '2' })
export class DeviceGroupsController {
  constructor(private readonly groups: DeviceGroupsService) {}

  @Get('state')
  @RequirePermission('wa.groups.read')
  @ApiOperation({
    summary: 'Can this number use Groups now? Reason, and what is left of its limits',
  })
  state(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.state(id);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.read')
  @ApiOperation({
    summary: 'Read the whole group list from WhatsApp now (once a minute per number)',
  })
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.syncAll(id);
  }

  @Post('join-by-link/preview')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.manage')
  @ApiOperation({
    summary: 'What an invite link points at, without joining (off unless the platform enables it)',
  })
  joinPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(waDeviceGroupJoinPreviewBodySchema)) body: WaDeviceGroupJoinPreviewBody,
  ) {
    return this.groups.joinPreview(id, body);
  }

  @Post('join-by-link')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.manage')
  @ApiOperation({
    summary: 'Join a group by invite link (highest ban risk: own cap, off by default)',
  })
  join(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(waDeviceGroupJoinBodySchema)) body: WaDeviceGroupJoinBody,
  ) {
    return this.groups.join(id, body);
  }

  @Get()
  @RequirePermission('wa.groups.read')
  @ApiOperation({
    summary: 'Groups of the number from the directory, newest first, with the counters',
  })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(waDeviceGroupListByDeviceQuerySchema)) query: WaDeviceGroupListByDeviceQuery,
  ) {
    return this.groups.list(id, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('wa.groups.create')
  @ApiOperation({ summary: 'Create a group from the number (at most 20 people; 5 creates a day)' })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createWaDeviceGroupBodySchema)) body: CreateWaDeviceGroupBody,
  ) {
    return this.groups.create(id, body);
  }

  @Get(':gid')
  @RequirePermission('wa.groups.read')
  get(@Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string) {
    return this.groups.get(id, gid);
  }

  @Post(':gid/refresh')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.read')
  @ApiOperation({ summary: 'Re-read one group from WhatsApp (members and settings)' })
  refresh(@Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string) {
    return this.groups.refresh(id, gid);
  }

  @Patch(':gid')
  @Idempotent()
  @RequirePermission('wa.groups.manage')
  @ApiOperation({
    summary: 'Change subject, description, announce, restrict, join approval, who may add members',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body(zodPipe(updateWaDeviceGroupInputSchema)) body: UpdateWaDeviceGroupInput,
  ) {
    return this.groups.update(id, gid, body);
  }

  @Put(':gid/picture')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(PictureTooLargeInterceptor, pictureUpload)
  @ApiOperation({
    summary: 'Set the group picture (multipart field "file": JPEG or PNG, at most 5 MB)',
  })
  setPicture(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    return this.groups.setPicture(id, gid, file);
  }

  @Delete(':gid/picture')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.manage')
  removePicture(@Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string) {
    return this.groups.removePicture(id, gid);
  }

  @Get(':gid/participants')
  @RequirePermission('wa.groups.manage')
  @ApiOperation({
    summary: 'Members from the directory, paged (numbers are personal data: manage only)',
  })
  members(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Query(zodPipe(waDeviceGroupMembersQuerySchema)) query: WaDeviceGroupMembersQuery,
  ) {
    return this.groups.members(id, gid, query);
  }

  @Post(':gid/participants')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.manage')
  @ApiOperation({ summary: 'Add, promote or demote up to 20 people; the answer lists each number' })
  changeParticipants(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body(zodPipe(changeWaGroupParticipantsInputSchema)) body: ChangeWaGroupParticipantsInput,
  ) {
    return this.groups.changeParticipants(id, gid, body);
  }

  @Delete(':gid/participants')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.manage')
  @ApiOperation({ summary: 'Remove up to 20 people from the group' })
  removeParticipants(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body(zodPipe(removeBodySchema)) body: RemoveBody,
  ) {
    return this.groups.removeParticipants(id, gid, body.numbers);
  }

  @Get(':gid/join-requests')
  @RequirePermission('wa.groups.manage')
  @ApiOperation({
    summary: 'People waiting to join (the stored queue; ?fresh=1 asks WhatsApp now)',
  })
  joinRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Query(zodPipe(waDeviceGroupJoinRequestsQuerySchema)) query: WaDeviceGroupJoinRequestsQuery,
  ) {
    return this.groups.joinRequests(id, gid, query.fresh);
  }

  @Post(':gid/join-requests')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.manage')
  @ApiOperation({ summary: 'Approve or reject people waiting to join' })
  handleJoinRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body(zodPipe(handleWaDeviceGroupJoinRequestsInputSchema))
    body: HandleWaDeviceGroupJoinRequestsInput,
  ) {
    return this.groups.handleJoinRequests(id, gid, body);
  }

  @Get(':gid/invite-link')
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Authorization')
  @RequirePermission('wa.groups.manage')
  @ApiOperation({ summary: 'The invite link (a bearer secret; admin only)' })
  inviteLink(@Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string) {
    return this.groups.inviteLink(id, gid);
  }

  @Post(':gid/invite-link/reset')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Authorization')
  @RequirePermission('wa.groups.manage')
  @ApiOperation({ summary: 'New invite link; every link shared before stops working' })
  resetInviteLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
  ) {
    return this.groups.resetInviteLink(id, gid);
  }

  @Post(':gid/leave')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.groups.leave')
  @ApiOperation({
    summary: 'Leave the group (cannot be undone from here); the row stays, read-only',
  })
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body(zodPipe(leaveWaDeviceGroupInputSchema)) body: LeaveWaDeviceGroupInput,
  ) {
    return this.groups.leave(id, gid, body);
  }
}
