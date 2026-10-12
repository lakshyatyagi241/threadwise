import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { WidgetsService } from './widgets.service';

/**
 * The widget a website chat bot owns: its look (the Customize tab) and, once saved, its embed address (the Install tab).
 * It lives under the flow because a bot is built for one channel and has at most one widget.
 */
@ApiTags('widgets')
@ActorKinds('user')
@Controller({ path: 'flows/:flowId/widget', version: '2' })
export class FlowWidgetController {
  constructor(private readonly widgets: WidgetsService) {}

  @Get()
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: "A website chat bot's widget",
    description:
      '`widget` is null until the owner has saved Customize once, which is what keeps the "needs customizing" reminder on. 422 when the bot is not a website chat bot.',
  })
  get(@Param('flowId', ParseUUIDPipe) flowId: string) {
    return this.widgets.getForFlow(flowId);
  }

  @Put()
  @Idempotent()
  @RequirePermission('flb.flows.update')
  @ApiOperation({
    summary: "Save a website chat bot's widget look",
    description:
      'The first save creates the widget and counts as the first customization. Later saves send the `rowVersion` they were read at (409 ROW_VERSION_CONFLICT when stale).',
  })
  save(@Param('flowId', ParseUUIDPipe) flowId: string, @Body() body: unknown) {
    return this.widgets.saveForFlow(flowId, body);
  }
}
