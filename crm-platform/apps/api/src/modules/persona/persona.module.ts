import { Module } from '@nestjs/common';
import { PersonaVocabularyService } from './persona-vocabulary.service';
import { PersonaController } from './persona.controller';
import { PersonaRepository } from './persona.repository';
import { PersonaService } from './persona.service';

/**
 * Persona profiles (docs/specs/persona-profiles.md, BL-280). Phase 0 is the read side: `PersonaService.resolve(orgId)` gives the web the
 * persona view that rides on the session. The one workspace route so far is "Words we use" (BL-310, dynamic object naming); the other
 * workspace and operator endpoints arrive with the screens that use them (phases 1 to 4). The persona never gates a route.
 */
@Module({
  controllers: [PersonaController],
  providers: [PersonaRepository, PersonaService, PersonaVocabularyService],
  exports: [PersonaService],
})
export class PersonaModule {}
