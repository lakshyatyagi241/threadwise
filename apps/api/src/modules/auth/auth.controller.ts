import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('staff/login')
  @ApiOperation({ summary: 'Staff login (CRM/Inbox/Broadcast operators)' })
  async staffLogin(@Body(zodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.loginStaff(body.orgSlug, body.email, body.password);
  }

  @Public()
  @Post('partner/login')
  @ApiOperation({ summary: 'Sub-agent / channel-partner portal login' })
  async partnerLogin(@Body(zodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.loginPartnerAgent(body.orgSlug, body.email, body.password);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  async refresh(@Body(zodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }
}
