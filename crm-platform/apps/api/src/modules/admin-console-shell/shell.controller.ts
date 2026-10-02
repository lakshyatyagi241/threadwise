import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { saveNavLayoutRequestSchema, type SaveNavLayoutRequest } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AllowWhileGated, OperatorGuard, OperatorRoles } from '../auth';
import { NavLayoutService } from './nav-layout.service';

/** What the customer shell reads on load to draw its top bar. */
@ApiTags('shell')
@ActorKinds('user')
@AllowWhileGated()
@Controller({ path: 'shell/nav-layout', version: '2' })
export class ShellController {
  constructor(private readonly layout: NavLayoutService) {}

  @Get()
  @ApiOperation({ summary: 'Top-bar layout every customer sees (bar order and the More zone)' })
  get() {
    return this.layout.get();
  }
}

/** The operator editor (WD-ASHELL-009). Every operator reads; only super admins write. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/shell/nav-layout', version: '2' })
export class PlatformShellController {
  constructor(private readonly layout: NavLayoutService) {}

  @Get()
  @ApiOperation({ summary: 'Current top-bar layout' })
  get() {
    return this.layout.get();
  }

  @Put()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Save the top bar; unknown keys dropped, "more" always kept' })
  save(@Body(zodPipe(saveNavLayoutRequestSchema)) body: SaveNavLayoutRequest) {
    return this.layout.save(RequestContextStore.require().actorId!, body.bar);
  }

  @Post('reset')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Restore the default top bar' })
  reset() {
    return this.layout.reset(RequestContextStore.require().actorId!);
  }
}
