import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  setPaygwGatewayActiveRequestSchema,
  updatePaygwGatewayRequestSchema,
  uuidSchema,
  type SetPaygwGatewayActiveRequest,
  type UpdatePaygwGatewayRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { GatewayService } from './gateway.service';

/**
 * Platform payment gateways for operators (TW-PAYGW-002..004). Every operator role reads; only super admins write, and every
 * write lands in security_events with the field KEYS touched, never values.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/payment-gateways', version: '2' })
export class PlatformGatewaysController {
  constructor(private readonly gateways: GatewayService) {}

  @Get()
  @ApiOperation({
    summary:
      'Every gateway with status, region tags, credential schema and which fields hold a value',
  })
  async list() {
    return this.gateways.list();
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Save mode, sort order, currency whitelist and credentials (blank keeps a stored secret)',
  })
  async update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updatePaygwGatewayRequestSchema)) body: UpdatePaygwGatewayRequest,
  ) {
    return this.gateways.update(id, body);
  }

  @Post(':id/active')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Activate (needs a driver and every required field) or deactivate' })
  async setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setPaygwGatewayActiveRequestSchema)) body: SetPaygwGatewayActiveRequest,
  ) {
    return this.gateways.setActive(id, body);
  }
}
