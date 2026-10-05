import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { runIgFlowSchema, type RunIgFlowInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { FlowsService } from './flows.service';
import { RequirePlanFeature } from '../plans-subscriptions-trials';

/** Running an engine flow on an Instagram thread (WD-IG-012). */
@ApiTags('instagram')
@ActorKinds('user')
// Instagram management is entirely the extra-channels feature; the public inbound controller stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'instagram', version: '2' })
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @Get('flows')
  @RequirePermission('ig.flows.run')
  @ApiOperation({
    summary: 'The flows the engine can run for the linked accounts, and where to author more',
    description: 'Empty when no account is linked or the engine is off.',
  })
  list() {
    return this.flows.list();
  }

  @Post('conversations/:id/run-flow')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ig.flows.run')
  @ApiOperation({
    summary: 'Start a flow on an Instagram conversation',
    description:
      '404 for an unknown conversation; 422 IG_NOT_AN_INSTAGRAM_THREAD, IG_THREAD_NO_ENGINE_ID or IG_NOT_CONNECTED; 502 IG_FLOW_RUN_FAILED with the engine’s words.',
  })
  run(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(runIgFlowSchema)) body: RunIgFlowInput,
  ) {
    return this.flows.run(id, body.flowId);
  }
}
