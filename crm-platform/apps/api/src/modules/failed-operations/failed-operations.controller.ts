import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  failedOperationsQuerySchema,
  redriveRequestSchema,
  terminateRequestSchema,
  type FailedOperation,
  type FailedOperationDetail,
  type FailedOperationsQuery,
  type RedriveRequest,
  type RedriveResult,
  type TerminateRequest,
  type TerminateResult,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { FailedOperationsService } from './failed-operations.service';
import { toDetail, toFailedOperation } from './failed-operations.mapper';

/**
 * Background work that failed for good: the durable record, a redrive of ONE operation, and closing it. Every operator may look; only a
 * super admin redrives or closes. IP allowlist and MFA come from OperatorGuard. There is no "redrive all": each operation is judged on
 * its own record, and the request carries no payload.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/failed-operations', version: '2' })
export class FailedOperationsController {
  constructor(private readonly ops: FailedOperationsService) {}

  private operatorId(): number {
    return RequestContextStore.require().actorId!;
  }

  @Get()
  @ApiOperation({ summary: 'Failed background operations, newest first (no payload)' })
  async list(
    @Query(zodPipe(failedOperationsQuerySchema)) q: FailedOperationsQuery,
  ): Promise<FailedOperation[]> {
    const rows = await this.ops.list({
      limit: q.limit,
      openOnly: q.openOnly,
      ...(q.status ? { status: q.status } : {}),
      ...(q.queue ? { queue: q.queue } : {}),
    });
    return rows.map(toFailedOperation);
  }

  @Get(':uuid')
  @ApiOperation({
    summary: 'One failed operation with its history of captures, redrives and decisions',
  })
  async detail(@Param('uuid', ParseUUIDPipe) uuid: string): Promise<FailedOperationDetail> {
    const { row, events } = await this.ops.detail(uuid);
    return toDetail(row, events);
  }

  @Post(':uuid/redrive')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Put one failed operation back on its queue, if the eligibility check allows it',
  })
  redrive(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body(zodPipe(redriveRequestSchema)) body: RedriveRequest,
  ): Promise<RedriveResult> {
    return this.ops.redrive(uuid, this.operatorId(), body.acknowledgeRepair);
  }

  @Post(':uuid/terminate')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Close one failed operation without running it; the stored payload is deleted',
  })
  terminate(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body(zodPipe(terminateRequestSchema)) body: TerminateRequest,
  ): Promise<TerminateResult> {
    return this.ops.terminate(uuid, this.operatorId(), body.reason);
  }
}
