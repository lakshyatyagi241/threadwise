import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  retentionItemIdSchema,
  retentionPreviewRequestSchema,
  retentionSaveRequestSchema,
  type RetentionItemId,
  type RetentionPreviewRequest,
  type RetentionSaveRequest,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { RetentionDashboardService } from './retention-dashboard.service';

/**
 * The retention dashboard (super admin console): per data item, how long it stays live and how long the archive keeps it.
 * Every operator may look; only a super admin changes anything. IP allowlist and MFA come from OperatorGuard.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/data-retention', version: '2' })
export class RetentionDashboardController {
  constructor(private readonly dashboard: RetentionDashboardService) {}

  private operatorId(): number {
    return RequestContextStore.require().actorId!;
  }

  @Get()
  @ApiOperation({
    summary:
      'Every data item with its retention policy, size, archive size and last run, plus what the archive job may do',
  })
  overview() {
    return this.dashboard.overview();
  }

  @Patch('items/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Save live days and archive days for one item. Needs the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). ' +
      'Audited. Nothing is deleted by this call: the nightly jobs apply it.',
  })
  save(
    @Param('id', zodPipe(retentionItemIdSchema)) id: RetentionItemId,
    @Body(zodPipe(retentionSaveRequestSchema)) body: RetentionSaveRequest,
  ) {
    return this.dashboard.save(id, body, this.operatorId());
  }

  @Delete('items/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Return one item to its built-in behaviour (audited, safe to repeat)' })
  reset(@Param('id', zodPipe(retentionItemIdSchema)) id: RetentionItemId) {
    return this.dashboard.reset(id, this.operatorId());
  }

  @Post('items/:id/preview')
  @ApiOperation({
    summary: 'What the next run would archive or delete with these values. Changes nothing.',
  })
  preview(
    @Param('id', zodPipe(retentionItemIdSchema)) id: RetentionItemId,
    @Body(zodPipe(retentionPreviewRequestSchema)) body: RetentionPreviewRequest,
  ) {
    return this.dashboard.preview(id, body);
  }
}
