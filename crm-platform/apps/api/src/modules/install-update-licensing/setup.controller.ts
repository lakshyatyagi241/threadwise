import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  licenceVerifyRequestSchema,
  setupBootstrapRequestSchema,
  setupDatabaseTestRequestSchema,
  setupRunRequestSchema,
  verifySetupTokenRequestSchema,
  type LicenceVerifyRequest,
  type SetupBootstrapRequest,
  type SetupBootstrapResponse,
  type SetupDatabaseDefaults,
  type SetupDatabaseTestRequest,
  type SetupDatabaseTestResponse,
  type SetupRequirementsResponse,
  type SetupRunRequest,
  type SetupRunResponse,
  type SetupStatusResponse,
  type VerifySetupTokenRequest,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Throttle } from '../platform-infrastructure';
import { SetupService } from './setup.service';

/**
 * First-run setup. Public by necessity (no account exists yet) and therefore guarded by the deploy-time setup token
 * and by the lock, which every call re-checks; once setup is complete every route here but `status` answers 409.
 * The token travels in the body, not a header: the same-origin proxy forwards bodies only.
 */
@ApiTags('setup')
@Public()
// the setup token is a deploy-time secret every call here checks, so guessing it is capped; setup is a one-off, 30 a minute is ample
@Throttle({ limit: 30, windowSeconds: 60, by: 'ip' })
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

  @Post('requirements')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Server requirements check (runtime, services, directories, database)' })
  requirements(
    @Body(zodPipe(verifySetupTokenRequestSchema)) body: VerifySetupTokenRequest,
  ): Promise<SetupRequirementsResponse> {
    return this.setup.requirements(body.setupToken);
  }

  @Post('verify-licence')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the purchase code (only on deployments that enforce one)' })
  async verifyLicence(
    @Body(zodPipe(licenceVerifyRequestSchema)) body: LicenceVerifyRequest,
  ): Promise<{ ok: true }> {
    await this.setup.verifyLicence(body.setupToken, body.purchaseCode);
    return { ok: true };
  }

  @Post('database-defaults')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "The deployment's own database connection, without its password" })
  databaseDefaults(
    @Body(zodPipe(verifySetupTokenRequestSchema)) body: VerifySetupTokenRequest,
  ): Promise<SetupDatabaseDefaults> {
    return this.setup.databaseDefaults(body.setupToken);
  }

  @Post('test-database')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test a database connection (422 with the server message on failure)' })
  testDatabase(
    @Body(zodPipe(setupDatabaseTestRequestSchema)) body: SetupDatabaseTestRequest,
  ): Promise<SetupDatabaseTestResponse> {
    return this.setup.testDatabase(body);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run one of the six install steps (idempotent; order enforced here)' })
  run(@Body(zodPipe(setupRunRequestSchema)) body: SetupRunRequest): Promise<SetupRunResponse> {
    return this.setup.run(body);
  }

  @Post('bootstrap')
  @ApiOperation({
    summary: 'Run all six install steps in order in one call; the last one locks setup',
  })
  bootstrap(
    @Body(zodPipe(setupBootstrapRequestSchema)) body: SetupBootstrapRequest,
  ): Promise<SetupBootstrapResponse> {
    return this.setup.bootstrap(body);
  }
}
