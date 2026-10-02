import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SystemStatusResponse } from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { OperatorGuard } from '../auth';
import { SystemService } from './system.service';

/** Read-only system status for every platform operator role. There is deliberately no mutating route here. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/system', version: '2' })
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get()
  @ApiOperation({ summary: 'Version, build, migration ledger and dependency checks' })
  status(): Promise<SystemStatusResponse> {
    return this.system.status();
  }
}
