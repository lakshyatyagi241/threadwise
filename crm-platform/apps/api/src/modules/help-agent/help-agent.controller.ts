import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HELP_AGENT_TASK_HEADER,
  finishHelpAgentTaskSchema,
  saveHelpAgentSettingsSchema,
  startHelpAgentTaskSchema,
  type FinishHelpAgentTaskInput,
  type SaveHelpAgentSettingsInput,
  type StartHelpAgentTaskInput,
} from '@crm/contracts';
import { ActorKinds, CurrentActor, RequirePermission } from '../../common/decorators';
import type { RequestContext } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { Throttle } from '../platform-infrastructure';
import { HelpAgentProxyService } from './help-agent-proxy.service';
import { HelpAgentService } from './help-agent.service';

/**
 * The Help assistant (docs/specs/help-agent-assistant.md section 8). The whole controller is the `help_agent` plan feature, reads
 * included; the workspace switch is checked by the services, because it is data and not a decorator.
 */
@ApiTags('help-agent')
@ActorKinds('user')
@RequirePlanFeature('help_agent')
@Controller({ path: 'help-agent', version: '2' })
export class HelpAgentController {
  constructor(
    private readonly agent: HelpAgentService,
    private readonly proxy: HelpAgentProxyService,
  ) {}

  @Get('status')
  @RequirePermission('help.agent.use')
  @Throttle('ui-poll')
  @ApiOperation({ summary: 'Is the assistant on for this person, and how much of today is left' })
  status(@CurrentActor() actor: RequestContext) {
    return this.agent.status(actor.grants?.get('help.agent.manage')?.effect === 'allow');
  }

  @Get('settings')
  @RequirePermission('help.agent.manage')
  @ApiOperation({ summary: 'The workspace switch of the assistant' })
  settings() {
    return this.agent.settings();
  }

  @Put('settings')
  @RequirePermission('help.agent.manage')
  @ApiOperation({ summary: 'Switch the assistant on or off for the workspace (audited)' })
  saveSettings(@Body(zodPipe(saveHelpAgentSettingsSchema)) body: SaveHelpAgentSettingsInput) {
    return this.agent.saveSettings(body);
  }

  @Post('tasks')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('help.agent.use')
  @Throttle({ limit: 20, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Start a task: checks the switch, the screen and the daily caps, and opens the step budget',
    description:
      '403 HELP_AGENT_DISABLED, 429 HELP_AGENT_TASK_LIMIT. Only the length of the task sentence is sent; it is never stored.',
  })
  start(@Body(zodPipe(startHelpAgentTaskSchema)) body: StartHelpAgentTaskInput) {
    return this.agent.start(body);
  }

  @Post('tasks/:id/finish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('help.agent.use')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Close a task and write its audit event; a second call changes nothing',
  })
  finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(finishHelpAgentTaskSchema)) body: FinishHelpAgentTaskInput,
  ) {
    return this.agent.finish(id, body);
  }

  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('help.agent.use')
  // One task is at most 25 calls; a busy person on several tasks stays well under this.
  @Throttle({ limit: 60, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'OpenAI-compatible chat completion with tool calls, for the assistant library',
    description:
      "Needs the `X-Help-Agent-Task` header from `POST /tasks`. The model, the output size and the key are the server's. Not streamed. " +
      '404 unknown task, 409 HELP_AGENT_TASK_CLOSED, 429 HELP_AGENT_STEP_LIMIT, 502/503 HELP_AGENT_PROVIDER_UNAVAILABLE.',
  })
  completions(@Headers(HELP_AGENT_TASK_HEADER) taskId: string | undefined, @Body() body: unknown) {
    return this.proxy.complete(taskId, body);
  }
}
