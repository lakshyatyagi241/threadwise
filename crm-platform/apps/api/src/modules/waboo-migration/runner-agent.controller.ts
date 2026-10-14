import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  uuidSchema,
  wabooMigrationRunnerClaimSchema,
  wabooMigrationRunnerFinishSchema,
  wabooMigrationRunnerReportSchema,
  type WabooMigrationRunnerClaim,
  type WabooMigrationRunnerFinish,
  type WabooMigrationRunnerReport,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Throttle } from '../platform-infrastructure';
import { RunnerJobs } from './runner-jobs';
import { eventsOf, runnerTokenMatches } from './runner-auth';
import { scrub, tail } from './waboo-migration.rules';

/**
 * The runner agent's door. NOT an operator or user endpoint: the agent is a script on a machine that is on the Geta VPN (the only place
 * Waboo's database answers), so it cannot hold an operator session. It proves itself with one bearer token (WABOO_RUNNER_TOKEN, 32+
 * characters, in its own environment and the API's), checked in constant time, rate limited by address, and every answer for a wrong or
 * missing token is the same 401. The agent can only (1) ask for the job of a run that is already running, (2) report events for a job it
 * claimed, (3) finish it. It can never create, change or cancel a run, and nothing it sends is stored unvalidated or unscrubbed.
 */
@ApiTags('platform')
@Public()
@Throttle({ limit: 240, windowSeconds: 60, by: 'ip' })
@Controller({ path: 'platform/waboo-migration/runner', version: '2' })
export class WabooMigrationRunnerController {
  constructor(private readonly jobs: RunnerJobs) {}

  private auth(header: string | undefined): void {
    if (!runnerTokenMatches(process.env.WABOO_RUNNER_TOKEN, header))
      throw AppError.unauthenticated('Invalid or missing runner token');
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Runner agent: ask for the job of a running migration',
    description: '200 with { job: null } when there is nothing to do. Also the agent heartbeat.',
  })
  async claim(
    @Headers('authorization') authorization: string | undefined,
    @Body(zodPipe(wabooMigrationRunnerClaimSchema)) body: WabooMigrationRunnerClaim,
  ) {
    this.auth(authorization);
    return { job: await this.jobs.claim(body.runner) };
  }

  @Post('jobs/:id/report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Runner agent: report the pipeline output (or a heartbeat) for a claimed job',
    description: 'Answers { cancel: true } when the agent must stop the pipeline now.',
  })
  async report(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(wabooMigrationRunnerReportSchema)) body: WabooMigrationRunnerReport,
  ) {
    this.auth(authorization);
    return this.jobs.push(
      id,
      body.runner,
      eventsOf(body.lines),
      scrub(tail(body.stderrTail, 4096)),
    );
  }

  @Post('jobs/:id/finish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Runner agent: the pipeline ended (exit code, timed out, stderr tail)' })
  async finish(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(wabooMigrationRunnerFinishSchema)) body: WabooMigrationRunnerFinish,
  ) {
    this.auth(authorization);
    const ok = await this.jobs.finish(id, body.runner, {
      exitCode: body.exitCode,
      timedOut: body.timedOut,
      stderrTail: scrub(tail(body.stderrTail, 2048)),
    });
    return { ok };
  }
}
