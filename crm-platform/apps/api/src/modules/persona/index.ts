/** Public surface of persona profiles (BL-280). Other modules import from here, never from the files behind it. */
export { PersonaModule } from './persona.module';
export { PersonaService } from './persona.service';
export { provisionWorkspacePersona } from './persona-provisioning';
