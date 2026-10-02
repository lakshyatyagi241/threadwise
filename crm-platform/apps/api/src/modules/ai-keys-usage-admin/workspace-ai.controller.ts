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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  aiProviderSlugSchema,
  aiUsageQuerySchema,
  saveWorkspaceAiKeySchema,
  setWorkspaceAiKeyActiveSchema,
  type AiProviderSlug,
  type AiUsageQuery,
  type SaveWorkspaceAiKeyInput,
  type SetWorkspaceAiKeyActiveInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AiModelsService } from './ai-models.service';
import { AiUsageService } from './ai-usage.service';
import { WorkspaceKeysService } from './workspace-keys.service';

/** A workspace's own provider keys (TW-AIADM-011..014). */
@ApiTags('ai')
@ActorKinds('user')
@Controller({ path: 'ai/provider-keys', version: '2' })
export class WorkspaceAiKeysController {
  constructor(private readonly keys: WorkspaceKeysService) {}

  @Get()
  @RequirePermission('aiadm.keys.read')
  @ApiOperation({
    summary: 'The workspace keys (never the secret) and which key each vendor would use',
  })
  async list() {
    return this.keys.list();
  }

  @Put(':provider')
  @Idempotent()
  @RequirePermission('aiadm.keys.manage')
  @ApiOperation({ summary: 'Add or replace the key for a vendor, and switch it on' })
  async save(
    @Param('provider', zodPipe(aiProviderSlugSchema)) provider: AiProviderSlug,
    @Body(zodPipe(saveWorkspaceAiKeySchema)) body: SaveWorkspaceAiKeyInput,
  ) {
    return this.keys.save(provider, body.apiKey);
  }

  @Patch(':id/active')
  @RequirePermission('aiadm.keys.manage')
  @ApiOperation({ summary: 'Switch a saved key on or off (idempotent)' })
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setWorkspaceAiKeyActiveSchema)) body: SetWorkspaceAiKeyActiveInput,
  ) {
    return this.keys.setActive(id, body.isActive);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('aiadm.keys.manage')
  @ApiOperation({ summary: 'Remove a saved key; calls fall back to the platform key' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.keys.remove(id);
  }
}

/** The workspace's AI usage and monthly cap (TW-AIADM-025..027). */
@ApiTags('ai')
@ActorKinds('user')
@Controller({ path: 'ai/usage', version: '2' })
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get()
  @RequirePermission('aiadm.usage.read')
  @ApiOperation({
    summary: 'Tokens, calls and estimated cost for a window, with the plan cap meter',
  })
  async get(@Query(zodPipe(aiUsageQuerySchema)) query: AiUsageQuery) {
    return this.usage.forWorkspace(query);
  }
}

/** The model picker the AI editors read (TW-AIADM-015). `aiadm.models.read`, held by every preset. */
@ApiTags('ai')
@ActorKinds('user')
@Controller({ path: 'ai/models', version: '2' })
export class AiModelsController {
  constructor(private readonly models: AiModelsService) {}

  @Get()
  @RequirePermission('aiadm.models.read')
  @ApiOperation({ summary: 'Text models available to this workspace (platform keys plus its own)' })
  async list() {
    return this.models.list();
  }
}
