import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  changeEmailRequestSchema,
  changePasswordRequestSchema,
  confirmEmailChangeRequestSchema,
  deleteAccountRequestSchema,
  mfaDisableRequestSchema,
  mfaEnableRequestSchema,
  mfaSetupRequestSchema,
  passkeyOptionsRequestSchema,
  passkeyRegisterRequestSchema,
  passkeyRemoveRequestSchema,
  regenerateRecoveryCodesRequestSchema,
  sessionListQuerySchema,
  updateBrandingRequestSchema,
  updateProfileRequestSchema,
  type ChangeEmailRequest,
  type ChangePasswordRequest,
  type DeleteAccountRequest,
  type MfaDisableRequest,
  type MfaEnableRequest,
  type MfaSetupRequest,
  type PasskeyOptionsRequest,
  type PasskeyRegisterRequest,
  type PasskeyRemoveRequest,
  type SessionListQuery,
  type UpdateBrandingRequest,
  type UpdateProfileRequest,
} from '@crm/contracts';
import { z } from 'zod';
import { ActorKinds, Public, RequirePermission } from '../../../common/decorators';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { AccountService, AVATAR_MAX_BYTES } from '../account/account.service';
import { UploadTooLargeInterceptor } from '../account/upload-too-large.interceptor';
import { RecoveryService } from '../flows/recovery.service';
import { AllowWhileGated } from '../guards/auth-gates';
import { MfaService } from '../security/mfa.service';
import { WebAuthnService } from '../security/webauthn.service';

/** Self-service account screens. Every route acts on the caller; there is no user id in any path. */
@ApiTags('account')
@ActorKinds('user')
@Controller({ path: 'account', version: '2' })
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly recovery: RecoveryService,
    private readonly mfa: MfaService,
    private readonly webauthn: WebAuthnService,
  ) {}

  private actor() {
    const ctx = RequestContextStore.require();
    return { orgId: ctx.orgId, userId: ctx.userId! };
  }

  // --- profile ------------------------------------------------------------------------------------------

  @Get('profile')
  @ApiOperation({ summary: 'My profile' })
  async profile() {
    return this.account.getProfile();
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Update my profile (and the workspace timezone, for owners and admins)',
  })
  async updateProfile(@Body(zodPipe(updateProfileRequestSchema)) body: UpdateProfileRequest) {
    return this.account.updateProfile(body);
  }

  @Post('email-change')
  @ApiOperation({
    summary: 'Ask to change my sign-in email; a confirmation goes to the new address',
  })
  async requestEmailChange(@Body(zodPipe(changeEmailRequestSchema)) body: ChangeEmailRequest) {
    await this.recovery.requestEmailChange(body);
    return { ok: true };
  }

  @Public()
  @Post('email-change/confirm')
  @ApiOperation({ summary: 'Confirm a new email address with the emailed token' })
  async confirmEmailChange(
    @Body(zodPipe(confirmEmailChangeRequestSchema))
    body: z.infer<typeof confirmEmailChangeRequestSchema>,
  ) {
    await this.recovery.confirmEmailChange(body.orgSlug, body.token);
    return { ok: true };
  }

  // --- avatar -------------------------------------------------------------------------------------------------

  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  // The transport cap sits a little above the photo limit so a file just over it still
  // reaches the upload policy and gets its precise message; anything bigger is cut off
  // here and answered by the interceptor with the same stable code and the limit.
  @UseInterceptors(
    UploadTooLargeInterceptor,
    FileInterceptor('file', { limits: { fileSize: Math.ceil(AVATAR_MAX_BYTES * 1.2), files: 1 } }),
  )
  @ApiOperation({ summary: 'Upload my photo (JPG, PNG, WebP or GIF, up to 1 MB)' })
  async setAvatar(@UploadedFile() file: { originalname: string; buffer: Buffer } | undefined) {
    if (!file)
      throw AppError.validation('Choose an image to upload', [
        { path: 'file', message: 'Required.' },
      ]);
    return this.account.setAvatar(file);
  }

  @Delete('avatar')
  @ApiOperation({ summary: 'Remove my photo' })
  async removeAvatar() {
    await this.account.removeAvatar();
    return { ok: true };
  }

  @Get('avatar')
  @ApiExcludeEndpoint()
  async avatar(@Res() res: Response) {
    const avatar = await this.account.readAvatar();
    if (!avatar) {
      res
        .status(404)
        .type('application/problem+json')
        .send({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' });
      return;
    }
    res
      .status(200)
      .setHeader('content-type', avatar.mime)
      .setHeader('etag', `"${avatar.etag}"`)
      // The URL carries ?v=<etag>, so it can be cached hard and still change when the photo does.
      .setHeader('cache-control', 'private, max-age=31536000, immutable')
      .setHeader('x-content-type-options', 'nosniff')
      .send(avatar.bytes);
  }

  // --- password, deletion, branding ----------------------------------------------------------------------------------

  @Post('password')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Change my password (other devices are signed out)' })
  async changePassword(@Body(zodPipe(changePasswordRequestSchema)) body: ChangePasswordRequest) {
    return this.account.changePassword(body);
  }

  @Delete()
  @ApiOperation({ summary: 'Permanently delete my account' })
  async deleteAccount(@Body(zodPipe(deleteAccountRequestSchema)) body: DeleteAccountRequest) {
    await this.account.deleteAccount(body);
    return { ok: true };
  }

  @Get('branding')
  @ApiOperation({ summary: 'The footer appended to outgoing messages' })
  async branding() {
    return this.account.getBranding();
  }

  @Patch('branding')
  @RequirePermission('auth.branding.update')
  @ApiOperation({ summary: 'Set, clear or reset the outgoing message footer' })
  async updateBranding(@Body(zodPipe(updateBrandingRequestSchema)) body: UpdateBrandingRequest) {
    return this.account.updateBranding(body);
  }

  // --- two-factor ------------------------------------------------------------------------------------------------------

  @Get('mfa')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Two-factor status' })
  async mfaStatus() {
    const { orgId, userId } = this.actor();
    return this.mfa.status(orgId, userId);
  }

  @Post('mfa/setup')
  @AllowWhileGated()
  @ApiOperation({
    summary: 'Start enrolling an authenticator app (same secret within 10 minutes)',
    description:
      'Needs recent authentication: a session that signed in less than 10 minutes ago passes, an older one must send the password (403 AUTH_REAUTH_REQUIRED otherwise).',
  })
  async mfaSetup(@Body(zodPipe(mfaSetupRequestSchema)) body: MfaSetupRequest) {
    const { orgId, userId } = this.actor();
    const profile = await this.account.getProfile();
    return this.mfa.beginSetup(orgId, userId, profile.email, body.password);
  }

  @Post('mfa/enable')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Confirm the first code; returns the one-time recovery codes' })
  async mfaEnable(@Body(zodPipe(mfaEnableRequestSchema)) body: MfaEnableRequest) {
    const { orgId, userId } = this.actor();
    return this.mfa.enable(orgId, userId, body.code, body.password);
  }

  @Post('mfa/disable')
  @AllowWhileGated()
  @ApiOperation({
    summary: 'Turn two-factor off (password and a current authenticator or recovery code required)',
  })
  async mfaDisable(@Body(zodPipe(mfaDisableRequestSchema)) body: MfaDisableRequest) {
    const { orgId, userId } = this.actor();
    await this.mfa.disable(orgId, userId, body.password, body.code);
    return { ok: true };
  }

  @Post('mfa/recovery-codes')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Replace my recovery codes (password required)' })
  async regenerateRecoveryCodes(
    @Body(zodPipe(regenerateRecoveryCodesRequestSchema))
    body: z.infer<typeof regenerateRecoveryCodesRequestSchema>,
  ) {
    const { orgId, userId } = this.actor();
    return this.mfa.regenerateRecoveryCodes(orgId, userId, body.password);
  }

  // --- passkeys (a second factor next to the authenticator app) ---------------------------------------------------

  @Get('passkeys')
  @AllowWhileGated()
  @ApiOperation({ summary: 'My passkeys' })
  async passkeys() {
    const { orgId, userId } = this.actor();
    return { data: await this.webauthn.list({ pool: 'user', orgId, userId }) };
  }

  @Post('passkeys/options')
  @AllowWhileGated()
  @ApiOperation({
    summary: 'Registration options for a new passkey',
    description:
      'Needs two-factor on (409 AUTH_PASSKEY_NEEDS_MFA) and recent authentication (403 AUTH_REAUTH_REQUIRED: send the password).',
  })
  async passkeyOptions(@Body(zodPipe(passkeyOptionsRequestSchema)) body: PasskeyOptionsRequest) {
    const { orgId, userId } = this.actor();
    await this.mfa.assertPasskeyAllowed(orgId, userId, body.password);
    const profile = await this.account.getProfile();
    return this.webauthn.registrationOptions(
      { pool: 'user', orgId, userId },
      { userName: profile.email, displayName: profile.displayName ?? profile.fullName },
    );
  }

  @Post('passkeys')
  @AllowWhileGated()
  @ApiOperation({ summary: "Verify the browser's answer and store the new passkey" })
  async passkeyRegister(@Body(zodPipe(passkeyRegisterRequestSchema)) body: PasskeyRegisterRequest) {
    const { orgId, userId } = this.actor();
    await this.mfa.assertPasskeyAllowed(orgId, userId, body.password);
    const item = await this.webauthn.register(
      { pool: 'user', orgId, userId },
      body.response,
      body.name,
    );
    await this.mfa.notifyChange(orgId, userId, 'passkey-added');
    return item;
  }

  @Post('passkeys/:id/remove')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Remove a passkey (password required)' })
  async passkeyRemove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(passkeyRemoveRequestSchema)) body: PasskeyRemoveRequest,
  ) {
    const { orgId, userId } = this.actor();
    await this.mfa.confirmPassword(orgId, userId, body.password);
    if (!(await this.webauthn.remove({ pool: 'user', orgId, userId }, id))) {
      throw AppError.notFound('Passkey', id);
    }
    await this.mfa.notifyChange(orgId, userId, 'passkey-removed');
    return { ok: true };
  }

  // --- devices -------------------------------------------------------------------------------------------------------------------

  @Get('sessions')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Devices I am signed in on (paged, current device first)' })
  async sessions(@Query(zodPipe(sessionListQuerySchema)) query: SessionListQuery) {
    return this.account.listSessions(query);
  }

  @Post('sessions/revoke-others')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Sign out everywhere except here' })
  async revokeOthers() {
    return { revoked: await this.account.revokeOtherSessions() };
  }

  @Delete('sessions/:id')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Sign out one device' })
  async revokeSession(@Param('id', ParseUUIDPipe) id: string) {
    await this.account.revokeSession(id);
    return { ok: true };
  }
}
