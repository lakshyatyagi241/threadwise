import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  languageVersionRequestSchema,
  setMyLocaleRequestSchema,
  updateLanguageRequestSchema,
  uuidSchema,
  type LanguageVersionRequest,
  type SetMyLocaleRequest,
  type UpdateLanguageRequest,
} from '@crm/contracts';
import { z } from 'zod';
import { ActorKinds, Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AllowWhileGated, OperatorGuard, OperatorRoles } from '../auth';
import { LanguagesService } from './languages.service';

/** The language registry for platform operators (WD-I18N-001..006). Every role reads; only super admins write. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/i18n/languages', version: '2' })
export class PlatformLanguagesController {
  constructor(private readonly languages: LanguagesService) {}

  @Get()
  @ApiOperation({ summary: 'Every language with the totals and the platform default' })
  list() {
    return this.languages.list();
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Adding languages is disabled (always refused with a stable code)' })
  add() {
    return this.languages.addDisabled();
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Edit a language name, native name, direction, active flag and order' })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateLanguageRequestSchema)) body: UpdateLanguageRequest,
  ) {
    return this.languages.update(id, body);
  }

  @Post(':id/toggle')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Switch a language on or off (never the platform default)' })
  toggle(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(languageVersionRequestSchema)) body: LanguageVersionRequest,
  ) {
    return this.languages.toggle(id, body.rowVersion);
  }

  @Post(':id/default')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Make an active language the platform default' })
  setDefault(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(languageVersionRequestSchema)) body: LanguageVersionRequest,
  ) {
    return this.languages.setDefault(id, body.rowVersion);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a language (never the platform default)' })
  async remove(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Query(zodPipe(z.object({ rowVersion: z.coerce.number().int().positive() })))
    query: LanguageVersionRequest,
  ) {
    await this.languages.remove(id, query.rowVersion);
    return { ok: true as const };
  }
}

/** What a language switcher and a guest's first page load need: the active list and the default. */
@ApiTags('i18n')
@Controller({ path: 'i18n', version: '2' })
export class PublicLanguagesController {
  constructor(private readonly languages: LanguagesService) {}

  @Public()
  @Get('languages')
  @ApiOperation({ summary: 'Active languages and the effective default locale' })
  list() {
    return this.languages.publicList();
  }
}

/**
 * The signed-in user's own language (WD-I18N-009). Reachable while an account gate is up so the lock screens can still
 * be read in the right language.
 */
@ApiTags('i18n')
@ActorKinds('user')
@Controller({ path: 'me/locale', version: '2' })
export class MyLocaleController {
  constructor(private readonly languages: LanguagesService) {}

  @AllowWhileGated({ suspended: true })
  @Get()
  @ApiOperation({
    summary: 'Inputs for resolving the caller locale (own choice, workspace default)',
  })
  mine() {
    return this.languages.myLocale();
  }

  @AllowWhileGated({ suspended: true })
  @Patch()
  @ApiOperation({ summary: 'Save the caller language (an active language only)' })
  set(@Body(zodPipe(setMyLocaleRequestSchema)) body: SetMyLocaleRequest) {
    return this.languages.setMyLocale(body.code);
  }
}
