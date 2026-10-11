import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  faqPlatformReindexSchema,
  faqPlatformWorkspacesQuerySchema,
  updateFaqPlatformConfigSchema,
  type FaqPlatformReindexInput,
  type FaqPlatformWorkspacesQuery,
  type UpdateFaqPlatformConfigInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { FaqPlatformService } from './faq-platform.service';

/** The platform operator's control of the FAQ engine. Super admins only, reads included: usage and key health are not for every role. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform/faq', version: '2' })
export class FaqPlatformController {
  constructor(private readonly platform: FaqPlatformService) {}

  @Get()
  @ApiOperation({ summary: 'The engine settings, the allowed models and the health numbers' })
  overview() {
    return this.platform.overview();
  }

  @Get('workspaces')
  @ApiOperation({
    summary: 'Workspaces by FAQ activity, with their indexing state and 30 day match counts',
  })
  workspaces(@Query(zodPipe(faqPlatformWorkspacesQuerySchema)) query: FaqPlatformWorkspacesQuery) {
    return this.platform.workspaces(query);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Change the switch, the embedding model, the generation model, the default threshold or the limits',
    description:
      'Changing the embedding model queues every stored vector to be made again; matching uses spelling similarity meanwhile.',
  })
  update(@Body(zodPipe(updateFaqPlatformConfigSchema)) body: UpdateFaqPlatformConfigInput) {
    return this.platform.update(body);
  }

  @Post('reindex')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Queue every vector (all) or only the ones that gave up (failed) to be made again',
  })
  reindex(@Body(zodPipe(faqPlatformReindexSchema)) body: FaqPlatformReindexInput) {
    return this.platform.reindex(body);
  }
}
