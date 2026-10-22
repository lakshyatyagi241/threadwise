import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  aiCrmMessageInputSchema,
  aiCrmSettingsInputSchema,
  type AiCrmMessageInput,
  type AiCrmSettingsInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Throttle } from '../platform-infrastructure';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { AiCrmCopilotService } from './ai-crm-copilot.service';

/**
 * AI CRM Copilot (AICRM; Reference `/ai-crm`; docs/threadwise-port/inventory/ai-copilot-lead-finder.md
 * TW-AICRM-001..011, 015, 016). Plan feature `ai_crm_copilot` gates every route. `aicrm.copilot.use` is the chat
 * itself; `aicrm.copilot.manage` (narrower, admin-only in practice via the permission preset grants) is the
 * WhatsApp-staff-channel toggle — nothing reads it yet (TW-AICRM-014 is blocked).
 */
@ApiTags('ai-crm')
@ActorKinds('user')
@RequirePlanFeature('ai_crm_copilot')
@Controller({ path: 'ai-crm', version: '2' })
export class AiCrmController {
  constructor(private readonly copilot: AiCrmCopilotService) {}

  @Get()
  @RequirePermission('aicrm.copilot.use')
  @ApiOperation({ summary: 'Recent copilot actions and the WhatsApp staff-channel toggle state' })
  index() {
    return this.copilot.index();
  }

  @Post('message')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('aicrm.copilot.use')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'One chat turn; a write tool is parked for confirm-before-act, not executed',
  })
  message(@Body(zodPipe(aiCrmMessageInputSchema)) body: AiCrmMessageInput) {
    return this.copilot.ask(body.message);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('aicrm.copilot.use')
  @ApiOperation({ summary: 'Clear the conversation history' })
  async reset() {
    await this.copilot.reset();
    return { ok: true };
  }

  @Post('settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('aicrm.copilot.manage')
  @ApiOperation({
    summary:
      'Toggle the WhatsApp staff-channel copilot (admin-only; TW-AICRM-015, no consumer yet)',
  })
  settings(@Body(zodPipe(aiCrmSettingsInputSchema)) body: AiCrmSettingsInput) {
    return this.copilot.setSettings(body.waCopilotEnabled);
  }
}
