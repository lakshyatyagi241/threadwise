import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  localeCodeSchema,
  saveWorkspaceVocabularySchema,
  type SaveWorkspaceVocabularyInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PersonaVocabularyService } from './persona-vocabulary.service';

const localeOf = (raw: string | undefined): string => {
  if (raw === undefined || raw === '') return 'en';
  const parsed = localeCodeSchema.safeParse(raw);
  if (!parsed.success) throw AppError.validation('The locale must be a language code such as en.');
  return parsed.data;
};

/**
 * Persona profiles, workspace side (BL-280, BL-310). One screen so far: "Words we use", where a workspace admin renames the core nouns
 * (contact, appointment, deal, meeting) as they appear in the web UI. The persona never gates a route; these two are gated like any other
 * setting, with `admin.settings.manage`, the key onboarding already uses (spec 9.2).
 */
@ApiTags('persona')
@ActorKinds('user')
@Controller({ path: 'persona/vocabulary', version: '2' })
export class PersonaController {
  constructor(private readonly vocabulary: PersonaVocabularyService) {}

  @Get()
  @RequirePermission('admin.settings.manage')
  @ApiOperation({
    summary:
      'The words this workspace uses for contact, appointment, deal and meeting, in one language',
    description:
      "For each noun: what is shown now (`effective`), which layer says so (`workspace`, `operator`, `persona`, or `default` for the product's own word) " +
      "and the workspace's own wording in that language. `rev` is the concurrency token for the save.",
  })
  get(@Query('locale') locale?: string) {
    return this.vocabulary.get(RequestContextStore.orgId(), localeOf(locale));
  }

  @Put()
  @RequirePermission('admin.settings.manage')
  @ApiOperation({
    summary: "Save this workspace's own wording for the core nouns",
    description:
      "Per noun: a map of languages (a value sets that language, `null` removes it, the others are kept), or `null` to remove the noun's wording in every language; " +
      'a noun left out is not touched. Labels in the web UI only: no API field, enum, export or webhook is renamed. A name is 1 to 40 characters: ' +
      'letters, numbers, spaces and - . & / ( ). 409 `ROW_VERSION_CONFLICT` when `rev` is no longer current.',
  })
  save(
    @Body(zodPipe(saveWorkspaceVocabularySchema)) body: SaveWorkspaceVocabularyInput,
    @Query('locale') locale?: string,
  ) {
    return this.vocabulary.save(body, localeOf(locale));
  }
}
