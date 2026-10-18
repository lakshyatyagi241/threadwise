import { Module } from '@nestjs/common';
import { PersonaRepository } from './persona.repository';
import { PersonaService } from './persona.service';

/**
 * Persona profiles (docs/specs/persona-profiles.md, BL-280), phase 0: the read side. `PersonaService.resolve(orgId)` gives the web the
 * persona view that rides on the session. There is no controller yet: the workspace and operator endpoints arrive with the screens that
 * use them (phases 1 to 4), and the persona never gates a route.
 */
@Module({
  providers: [PersonaRepository, PersonaService],
  exports: [PersonaService],
})
export class PersonaModule {}
