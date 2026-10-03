import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  simulatorInboundSchema,
  simulatorReceiptSchema,
  type SimulatorInboundInput,
  type SimulatorReceiptInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { SimulatorService } from './simulator.service';

/**
 * Dev-only: the pretend customer behind a simulator channel. Every route answers 404 unless the simulator is enabled (flag on and not
 * production). Messages and receipts go to the same ingest queue a real webhook feeds.
 */
@ApiTags('dev-simulator')
@ActorKinds('user')
@Controller({ path: 'dev/simulator/channels/:id', version: '2' })
export class SimulatorController {
  constructor(private readonly simulator: SimulatorService) {}

  @Post('inbound')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({
    summary: 'The simulated customer sends a message',
    description:
      'Text, media or location. A `/dup ` text prefix (or fault `dup`) delivers it three times under one provider id.',
  })
  async inbound(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(simulatorInboundSchema)) body: SimulatorInboundInput,
  ) {
    return this.simulator.inbound(id, body);
  }

  @Post('receipt')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('inbox.channel.manage')
  @ApiOperation({ summary: 'Force a delivery step for a message (out of order too)' })
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(simulatorReceiptSchema)) body: SimulatorReceiptInput,
  ) {
    return this.simulator.receipt(id, body);
  }
}
