import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWebhookTargetSchema,
  updateWebhookTargetSchema,
  uuidSchema,
  webhookFailuresQuerySchema,
  type CreateWebhookTargetInput,
  type UpdateWebhookTargetInput,
  type WebhookFailuresQuery,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { WebhookTargetsService } from './webhook-targets.service';

/**
 * The platform's webhook forward targets. Super admins only, reads included: a target URL and its header name are
 * infrastructure detail, not for every operator role.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform/webhook-targets', version: '2' })
export class WebhookFanoutController {
  constructor(private readonly targets: WebhookTargetsService) {}

  @Get()
  @ApiOperation({ summary: 'Every forward target with its delivery counters and pending failures' })
  async list() {
    return { data: await this.targets.list() };
  }

  @Post()
  @ApiOperation({
    summary: 'Add a forward target',
    description:
      'https only; a host that is or resolves to a private address is refused (422 WFWD_URL_REJECTED).',
  })
  async create(@Body(zodPipe(createWebhookTargetSchema)) body: CreateWebhookTargetInput) {
    return this.targets.create(body);
  }

  @Get('failures')
  @ApiOperation({ summary: 'Deliveries that ran out of retries, newest first (kept 14 days)' })
  async failures(@Query(zodPipe(webhookFailuresQuerySchema)) query: WebhookFailuresQuery) {
    return { data: await this.targets.failures(query) };
  }

  @Post('failures/:id/replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a failed delivery again now; marked replayed only on a 2xx answer',
  })
  async replay(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.targets.replay(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a target (requires the rowVersion you read)' })
  async update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateWebhookTargetSchema)) body: UpdateWebhookTargetInput,
  ) {
    return this.targets.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a target and its kept failures' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string): Promise<void> {
    await this.targets.remove(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a signed sample payload and report what the target answered' })
  async test(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.targets.test(id);
  }
}
