import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  loginRequestSchema,
  mfaLoginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  switchWorkspaceRequestSchema,
  type LoginRequest,
  type MfaLoginRequest,
  type SwitchWorkspaceRequest,
} from '@crm/contracts';
import { Public, ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AccountService } from './account/account.service';
import { AuthService } from './auth.service';
import { LoginService } from './flows/login.service';
import { clientMeta } from './support/client-meta';
import { WorkspaceSwitchService } from './flows/workspace-switch.service';
import { AllowWhileGated } from './guards/auth-gates';
import { AuthSettingsService } from './platform/auth-settings.service';

const partnerLoginSchema = z.object({
  orgSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

const clerkSessionSchema = z.object({
  orgSlug: z.string().min(1),
  clerkToken: z.string().min(1),
});

@ApiTags('auth')
@Controller({ path: 'auth', version: '2' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly login: LoginService,
    private readonly account: AccountService,
    private readonly workspaces: WorkspaceSwitchService,
    private readonly settings: AuthSettingsService,
  ) {}

  @Public()
  @Get('registration-config')
  @ApiOperation({
    summary: 'Public settings that shape the guest pages (sign-up open, captcha, social, copy)',
  })
  async registrationConfig() {
    return this.settings.publicConfig();
  }

  @Public()
  @Post('login')
  @ApiOperation({
    summary: 'Sign in with organization, email and password',
    description:
      'Returns a token pair, or `mfa_required` with a challenge token when the account has two-factor authentication on.',
  })
  async signIn(@Body(zodPipe(loginRequestSchema)) body: LoginRequest) {
    return this.login.login(body, clientMeta());
  }

  /** Kept so existing clients keep working; identical to POST /auth/login. */
  @Public()
  @Post('staff/login')
  @ApiOperation({ summary: 'Alias of POST /auth/login' })
  async staffLogin(@Body(zodPipe(loginRequestSchema)) body: LoginRequest) {
    return this.login.login(body, clientMeta());
  }

  @Public()
  @Post('login/mfa')
  @ApiOperation({ summary: 'Complete a sign-in with an authenticator or recovery code' })
  async signInMfa(@Body(zodPipe(mfaLoginRequestSchema)) body: MfaLoginRequest) {
    return this.login.loginMfa(body, clientMeta());
  }

  @Public()
  @Post('partner/login')
  @ApiOperation({ summary: 'Sub-agent / channel-partner portal login' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['orgSlug', 'email', 'password'],
      properties: {
        orgSlug: { type: 'string' },
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
    },
  })
  async partnerLogin(@Body(zodPipe(partnerLoginSchema)) body: z.infer<typeof partnerLoginSchema>) {
    return this.auth.loginPartnerAgent(body.orgSlug, body.email, body.password);
  }

  @Public()
  @Post('clerk/session')
  @ApiOperation({
    summary: 'Exchange a verified Clerk session token for a session (existing users only)',
  })
  async clerkSession(@Body(zodPipe(clerkSessionSchema)) body: z.infer<typeof clerkSessionSchema>) {
    return this.auth.loginViaClerk(body.orgSlug, body.clerkToken, clientMeta());
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token' })
  async refresh(@Body(zodPipe(refreshRequestSchema)) body: z.infer<typeof refreshRequestSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @ActorKinds('user')
  @AllowWhileGated({ suspended: true })
  @ApiOperation({ summary: 'End the current session' })
  async logout(@Body(zodPipe(logoutRequestSchema)) _body: z.infer<typeof logoutRequestSchema>) {
    await this.login.logout();
    return { ok: true };
  }

  @Get('session')
  @ActorKinds('user')
  @AllowWhileGated({ suspended: true })
  @ApiOperation({
    summary: 'Who am I: user, organization, roles, permissions, landing and account flags',
  })
  async session() {
    return this.account.sessionInfo();
  }

  @Get('workspaces')
  @ActorKinds('user')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Workspaces this verified email belongs to' })
  async listWorkspaces() {
    return this.workspaces.list();
  }

  @Post('workspaces/switch')
  @ActorKinds('user')
  @AllowWhileGated()
  @ApiOperation({ summary: 'Open a session in another workspace' })
  async switchWorkspace(@Body(zodPipe(switchWorkspaceRequestSchema)) body: SwitchWorkspaceRequest) {
    return this.workspaces.switch(body.orgSlug, clientMeta());
  }
}
