import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  /** Tenant slug. Email alone is not unique across orgs. */
  orgSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

const clerkSessionSchema = z.object({
  /** Tenant slug — Clerk doesn't know about our orgs, so this still comes from the client. */
  orgSlug: z.string().min(1),
  /** The Clerk session token (from useAuth().getToken() client-side) — not a password. */
  clerkToken: z.string().min(1),
});

const loginBodySchema = {
  type: 'object' as const,
  required: ['orgSlug', 'email', 'password'],
  properties: {
    orgSlug: { type: 'string' as const, example: 'studyfromuae' },
    email: { type: 'string' as const, format: 'email', example: 'admin@studyfromuae.test' },
    password: { type: 'string' as const, example: 'Passw0rd!' },
  },
};

const clerkSessionBodySchema = {
  type: 'object' as const,
  required: ['orgSlug', 'clerkToken'],
  properties: {
    orgSlug: { type: 'string' as const, example: 'studyfromuae' },
    clerkToken: { type: 'string' as const, example: 'eyJhbGciOiJSUzI1NiIs...' },
  },
};

@ApiTags('auth')
@Controller({ path: 'auth', version: '2' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('staff/login')
  @ApiOperation({ summary: 'Staff login (CRM/Inbox/Broadcast operators)' })
  @ApiBody({ schema: loginBodySchema })
  async staffLogin(@Body(zodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.loginStaff(body.orgSlug, body.email, body.password);
  }

  @Public()
  @Post('partner/login')
  @ApiOperation({ summary: 'Sub-agent / channel-partner portal login' })
  @ApiBody({ schema: loginBodySchema })
  async partnerLogin(@Body(zodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.loginPartnerAgent(body.orgSlug, body.email, body.password);
  }

  @Public()
  @Post('clerk/session')
  @ApiOperation({
    summary: 'Exchange a verified Clerk session token for our own token pair',
    description:
      'Clerk verifies the password/Google credential client-side. This endpoint verifies ' +
      'that session token server-side, links or auto-provisions the local user row, and ' +
      'issues the same access/refresh pair staff/login does — every other route stays unchanged.',
  })
  @ApiBody({ schema: clerkSessionBodySchema })
  async clerkSession(@Body(zodPipe(clerkSessionSchema)) body: z.infer<typeof clerkSessionSchema>) {
    return this.auth.loginViaClerk(body.orgSlug, body.clerkToken);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refreshToken'],
      properties: { refreshToken: { type: 'string' } },
    },
  })
  async refresh(@Body(zodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }
}
