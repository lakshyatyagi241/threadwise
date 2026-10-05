import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { onboardingWorkspaceRequestSchema, type OnboardingWorkspaceRequest } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { OnboardingService } from '../flows/onboarding.service';
import { AllowWhileGated } from '../guards/auth-gates';

/** First-run setup after sign-up. Onboarding stays reachable while an unverified email is gated. */
@ApiTags('auth')
@ActorKinds('user')
@AllowWhileGated()
@Controller({ path: 'onboarding', version: '2' })
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @ApiOperation({ summary: 'Where am I in first-run setup, and what is already filled in' })
  async get() {
    return this.onboarding.get();
  }

  @Post('workspace')
  @RequirePermission('admin.settings.manage')
  @ApiOperation({
    summary:
      'Step 1: name the workspace, set industry, team size and timezone; a mobile number too when the account has none',
    description:
      'Saving again after onboarding is complete edits the profile and does not reopen first-run setup. `currency` is optional and kept for API callers; the screen does not ask for it.',
  })
  async saveWorkspace(
    @Body(zodPipe(onboardingWorkspaceRequestSchema)) body: OnboardingWorkspaceRequest,
  ) {
    return this.onboarding.saveWorkspace(body);
  }

  @Post('complete')
  @RequirePermission('admin.settings.manage')
  @ApiOperation({ summary: 'Finish onboarding (also the "start free" action of the plan step)' })
  async complete() {
    return this.onboarding.complete();
  }
}
