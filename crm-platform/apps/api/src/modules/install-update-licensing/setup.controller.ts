import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  setupBootstrapRequestSchema,
  verifySetupTokenRequestSchema,
  type SetupBootstrapRequest,
  type SetupBootstrapResponse,
  type SetupStatusResponse,
  type VerifySetupTokenRequest,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { SetupService } from './setup.service';

/**
 * First-run setup. Public by necessity (no account exists yet) and therefore guarded by the deploy-time setup token
 * and by the lock, which every write re-checks; once setup is complete every route here answers 409.
 */
@ApiTags('setup')
@Public()
@Controller({ path: 'setup', version: '2' })
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  @ApiOperation({ summary: 'Is first-run setup open, and is the server ready for it' })
  status(): Promise<SetupStatusResponse> {
    return this.setup.status();
  }

  @Post('verify-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check the setup token before the form is filled in' })
  async verifyToken(
    @Body(zodPipe(verifySetupTokenRequestSchema)) body: VerifySetupTokenRequest,
  ): Promise<{ ok: true }> {
    await this.setup.verifyToken(body.setupToken);
    return { ok: true };
  }

  @Post('bootstrap')
  @ApiOperation({
    summary:
      'Create the first platform operator and organization, then lock setup (one transaction)',
  })
  bootstrap(
    @Body(zodPipe(setupBootstrapRequestSchema)) body: SetupBootstrapRequest,
  ): Promise<SetupBootstrapResponse> {
    return this.setup.bootstrap(body);
  }
}
