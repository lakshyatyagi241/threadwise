import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  deploymentsQuerySchema,
  publishesQuerySchema,
  type DeploymentsQuery,
  type DeploymentsResponse,
  type PublishesQuery,
  type PublishesResponse,
  type ReleasesResponse,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { DeploymentsService } from './deployments.service';

/**
 * Operator dashboard of flow publishes to the Geta console. Read-only: a stuck or failed publish is retried from the flow editor, the
 * same as before. Every platform operator may look; the IP allowlist and MFA come from OperatorGuard.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/deployments', version: '2' })
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Every flow publish to Geta: status, queue, running step and last error',
  })
  list(
    @Query(zodPipe(deploymentsQuerySchema)) query: DeploymentsQuery,
  ): Promise<DeploymentsResponse> {
    return this.deployments.list(query);
  }

  @Get('publishes')
  @ApiOperation({
    summary:
      'Flow publishes: outbox state of each flow.published event (queued, running, failed, done)',
  })
  publishes(
    @Query(zodPipe(publishesQuerySchema)) query: PublishesQuery,
  ): Promise<PublishesResponse> {
    return this.deployments.publishes(query);
  }

  @Get('releases')
  @ApiOperation({
    summary:
      'Product releases: live tag, the attempt in progress, and the newest attempts with steps and errors',
  })
  releases(): Promise<ReleasesResponse> {
    return this.deployments.releases();
  }
}
