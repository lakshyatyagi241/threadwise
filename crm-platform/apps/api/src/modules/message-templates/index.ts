/**
 * message-templates (TPL): WhatsApp template authoring, submission to Meta and sync. The pure rules (placeholders, the Meta create
 * payload, the pre-submit linter, Meta's state mapped onto a row) are separate files; the service, controller and worker jobs
 * build on them.
 */
export { MessageTemplatesModule } from './message-templates.module';
export { MessageTemplatesWorkerModule } from './message-templates-worker.module';
export { TemplatesService } from './templates.service';
export { TemplateSyncService } from './template-sync.service';
export * from './template-linter';
export * from './template-payload';
export * from './template-variables';
