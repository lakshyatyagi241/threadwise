import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateTranslationSettingsRequestSchema,
  type UpdateTranslationSettingsRequest,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { TranslationSettingsService } from './translation-settings.service';

/** Account > Translation for the signed-in workspace (WD-I18N-035). */
@ApiTags('i18n')
@ActorKinds('user')
@Controller({ path: 'workspace/translation-settings', version: '2' })
export class TranslationSettingsController {
  constructor(private readonly settings: TranslationSettingsService) {}

  @Get()
  @RequirePermission('i18n.translation_settings.read')
  @ApiOperation({ summary: 'Team language, auto-translate switch, engine and this month usage' })
  get() {
    return this.settings.get();
  }

  @Patch()
  @Idempotent()
  @RequirePermission('i18n.translation_settings.update')
  @ApiOperation({ summary: 'Change the team language or the auto-translate switch (plan-gated)' })
  update(
    @Body(zodPipe(updateTranslationSettingsRequestSchema)) body: UpdateTranslationSettingsRequest,
  ) {
    return this.settings.update(body);
  }
}
