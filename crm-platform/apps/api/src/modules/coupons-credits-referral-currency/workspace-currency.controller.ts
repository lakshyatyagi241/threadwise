import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  setWorkspaceCurrencyRequestSchema,
  type SetWorkspaceCurrencyRequest,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WorkspaceCurrencyService } from './workspace-currency.service';

/** The workspace's display currency (TW-CPN-027): anyone in the workspace reads it, only the owner changes it. */
@ApiTags('workspace')
@ActorKinds('user')
@Controller({ path: 'workspace/currency', version: '2' })
export class WorkspaceCurrencyController {
  constructor(private readonly currency: WorkspaceCurrencyService) {}

  @Get()
  @ApiOperation({
    summary: 'The workspace currency, the platform default and the currencies on offer',
  })
  get() {
    return this.currency.get();
  }

  @Put()
  @RequirePermission('org.owner_settings.manage')
  @ApiOperation({ summary: 'Pick the workspace currency (null follows the platform default)' })
  set(@Body(zodPipe(setWorkspaceCurrencyRequestSchema)) body: SetWorkspaceCurrencyRequest) {
    return this.currency.set(body);
  }
}
