/**
 * Public surface of the calling domain (CALL). Other modules import from here, never from the files behind it.
 * `CallingVoiceWorkerModule` binds the `calls` webhook field; `CallActionsService` and `CallPermissionService` are what a later AI call
 * assistant or the inbox's eligibility read call.
 */
export { CallingVoiceModule } from './calling-voice.module';
export { CallingVoiceWorkerModule } from './calling-voice-worker.module';
export { CallActionsService } from './call-actions.service';
export { CallPermissionService } from './call-permission.service';
