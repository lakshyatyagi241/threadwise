import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWebhookSchema,
  listWebhookDeliveriesQuerySchema,
  updateWebhookSchema,
  type CreateWebhookInput,
  type ListWebhookDeliveriesQuery,
  type UpdateWebhookInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { WebhooksService } from './webhooks.service';

/** A workspace's own webhooks (Settings > Integrations > Webhooks). Reading needs `webhooks.read`, every change `webhooks.manage`. */
@ApiTags('webhooks')
@ActorKinds('user')
@Controller({ path: 'webhooks', version: '2' })
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermission('webhooks.read')
  @ApiOperation({
    summary: "The workspace's webhooks and the events that can be subscribed to (never the secret)",
  })
  list() {
    return this.webhooks.list();
  }

  @Post()
  @RequirePermission('webhooks.manage')
  @RequirePlanFeature('outbound_webhooks')
  @ApiOperation({
    summary: 'Register a webhook',
    description:
      'https only; the host must resolve to public addresses. No events given means every event.',
  })
  create(@Body(zodPipe(createWebhookSchema)) body: CreateWebhookInput) {
    return this.webhooks.create(body);
  }

  @Patch(':id')
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Change a webhook (last write wins)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateWebhookSchema)) body: UpdateWebhookInput,
  ) {
    return this.webhooks.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Delete a webhook and its delivery log' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.webhooks.remove(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Send a test delivery now and answer with how it went' })
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.test(id);
  }

  @Get(':id/deliveries')
  @RequirePermission('webhooks.read')
  @ApiOperation({ summary: 'The most recent deliveries of one webhook, newest first' })
  deliveries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listWebhookDeliveriesQuerySchema)) query: ListWebhookDeliveriesQuery,
  ) {
    return this.webhooks.deliveries(id, query);
  }
}
