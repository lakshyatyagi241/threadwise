import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  lockdownRequestSchema,
  providerVersionRequestSchema,
  translationUsageQuerySchema,
  updateTranslationProviderRequestSchema,
  uuidSchema,
  type LockdownRequest,
  type ProviderVersionRequest,
  type TranslationUsageQuery,
  type UpdateTranslationProviderRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { ProvidersAdminService } from './providers-admin.service';
import { TranslationUsageService } from './translation-usage.service';

/**
 * Translation providers and the usage report for platform operators (WD-I18N-014..018, 030). Every role reads; only
 * super admins write.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/i18n', version: '2' })
export class TranslationPlatformController {
  constructor(
    private readonly providers: ProvidersAdminService,
    private readonly usage: TranslationUsageService,
  ) {}

  @Get('translation-providers')
  @ApiOperation({
    summary: 'The provider catalogue with credential forms (secrets never returned)',
  })
  list() {
    return this.providers.list();
  }

  // Declared before `:id` routes so "lockdown" is not read as an id.
  @Post('translation-providers/lockdown')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Turn the official-providers-only lockdown on or off' })
  lockdown(@Body(zodPipe(lockdownRequestSchema)) body: LockdownRequest) {
    return this.providers.setLockdown(body.enabled);
  }

  @Patch('translation-providers/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Save credentials and fallback order' })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateTranslationProviderRequestSchema)) body: UpdateTranslationProviderRequest,
  ) {
    return this.providers.update(id, body);
  }

  @Post('translation-providers/:id/toggle')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Activate or deactivate (activation needs the required credentials)' })
  toggle(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(providerVersionRequestSchema)) body: ProviderVersionRequest,
  ) {
    return this.providers.toggle(id, body.rowVersion);
  }

  @Post('translation-providers/:id/default')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Make an active provider the first one tried' })
  setDefault(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(providerVersionRequestSchema)) body: ProviderVersionRequest,
  ) {
    return this.providers.setDefault(id, body.rowVersion);
  }

  @Get('translation-usage')
  @ApiOperation({ summary: 'Translation volume and estimated cost for a date range' })
  report(@Query(zodPipe(translationUsageQuerySchema)) query: TranslationUsageQuery) {
    return this.usage.report(query);
  }
}
