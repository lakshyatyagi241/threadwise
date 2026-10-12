import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateSmsPlatformSchema,
  type SmsPlatformState,
  type UpdateSmsPlatformInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { SmsPlatformService } from './sms-platform.service';

/**
 * The operator console's SMS switch (TW-SMS-025). Every operator may read; only a super admin changes it, exactly like the
 * unofficial WhatsApp switch. IP allowlist and MFA come from OperatorGuard.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/sms', version: '2' })
export class SmsPlatformController {
  constructor(private readonly platform: SmsPlatformService) {}

  @Get()
  @ApiOperation({ summary: 'Whether the SMS channel is switched on for the whole platform' })
  read(): Promise<SmsPlatformState> {
    return this.platform.read();
  }

  @Put()
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Turn the SMS channel on or off for the whole platform',
    description:
      'Off by default. It only hides the SMS entry points (menu, pickers, template channel): senders, broadcasts and running sends are untouched either way. Audited as platform.sms_updated.',
  })
  update(
    @Body(zodPipe(updateSmsPlatformSchema)) body: UpdateSmsPlatformInput,
  ): Promise<SmsPlatformState> {
    return this.platform.update(body, RequestContextStore.require().actorId!);
  }
}
