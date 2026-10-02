import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  aiUsageQuerySchema,
  setAiKeyActiveSchema,
  updatePlatformAiKeySchema,
  uuidSchema,
  type AiUsageQuery,
  type SetAiKeyActiveInput,
  type UpdatePlatformAiKeyInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { AiUsageService } from './ai-usage.service';
import { PlatformKeysService } from './platform-keys.service';

/**
 * The platform's provider keys (WD-AIADM-001..004, 009). Super admins only, reads included: a key's last four
 * characters and which providers are live are not for every operator role.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform/ai-keys', version: '2' })
export class PlatformAiKeysController {
  constructor(private readonly keys: PlatformKeysService) {}

  @Get()
  @ApiOperation({
    summary: 'Every AI provider with its key state, and the four-count status strip',
  })
  async list() {
    return this.keys.list();
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Save a provider card (key, default model, order, token ceiling, extra models)',
    description:
      'Requires the rowVersion you read. A blank key keeps the saved one; removeKey deletes it. A keyless provider that gets a key is switched on.',
  })
  async update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updatePlatformAiKeySchema)) body: UpdatePlatformAiKeyInput,
  ) {
    return this.keys.update(id, body);
  }

  @Patch(':id/active')
  @ApiOperation({
    summary: 'Turn a provider on or off',
    description: 'Idempotent. Turning on needs a readable key: 422 AIADM_KEY_REQUIRED otherwise.',
  })
  async setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setAiKeyActiveSchema)) body: SetAiKeyActiveInput,
  ) {
    return this.keys.setActive(id, body.isActive);
  }
}

/** The platform-wide AI usage dashboard (WD-AIADM-020..024). Every operator role may read it. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/ai-dashboard', version: '2' })
export class PlatformAiDashboardController {
  constructor(private readonly usage: AiUsageService) {}

  @Get()
  @ApiOperation({ summary: 'Token burn by provider, model and workspace, plus key health' })
  async dashboard(@Query(zodPipe(aiUsageQuerySchema)) query: AiUsageQuery) {
    return this.usage.forPlatform(query);
  }
}
