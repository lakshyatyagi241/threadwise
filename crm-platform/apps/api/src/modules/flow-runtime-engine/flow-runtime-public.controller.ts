import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  enrollOneInputSchema,
  listFlowSubscribersQuerySchema,
  type EnrollOneInput,
  type ListFlowSubscribersQuery,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiKeyGuard } from '../public-api';
import { FlowRuntimeService } from './flow-runtime.service';

/**
 * Flows for API clients (TW-FLR-009): list them, read one, enrol a contact by id or phone, list a flow's subscribers. Authenticated by
 * the API key (the same signed scheme as the rest of `/public/v1`), scoped to the key's workspace.
 *
 * Compared with Reference: a subscriber list counts over every subscriber, not only the page returned.
 */
@ApiTags('public-api')
@Public()
@UseGuards(ApiKeyGuard)
@ApiHeader({ name: 'Authorization', description: 'ApiKey <prefix>.<secret>', required: true })
@ApiHeader({
  name: 'X-Signature',
  description: 'hex HMAC-SHA256 of `{timestamp}.{METHOD}.{path}.{rawBody}`',
  required: true,
})
@ApiHeader({ name: 'X-Timestamp', description: 'Unix seconds', required: true })
@Controller({ path: 'public/v1/flows', version: VERSION_NEUTRAL })
export class FlowRuntimePublicController {
  constructor(private readonly svc: FlowRuntimeService) {}

  @Get()
  @ApiOperation({ summary: 'List flows, most recently updated first' })
  list() {
    return this.svc.listFlows();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One flow with its subscriber count' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getFlow(id);
  }

  @Post(':id/enroll')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Enrol one contact, by id or phone',
    description:
      'Answers with the subscriber as it is: a contact already in the flow comes back with its status and no new run. 404 FLR_CONTACT_NOT_FOUND, 422 FLR_FLOW_INACTIVE.',
  })
  enroll(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(enrollOneInputSchema)) body: EnrollOneInput,
  ) {
    return this.svc.enrollOne(id, body);
  }

  @Get(':id/subscribers')
  @ApiOperation({ summary: "A flow's subscribers, newest first, with counts over all of them" })
  subscribers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listFlowSubscribersQuerySchema)) q: ListFlowSubscribersQuery,
  ) {
    return this.svc.subscribersOf(id, q);
  }
}
