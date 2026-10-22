/**
 * message-templates (TPL): WhatsApp template authoring, submission to Meta and sync. The pure rules (placeholders, the Meta create
 * payload, the pre-submit linter, Meta's state mapped onto a row) are separate files; the service, controller and worker jobs
 * build on them.
 */
export { MessageTemplatesModule } from './message-templates.module';
export { MessageTemplatesWorkerModule } from './message-templates-worker.module';
export { TemplatesService } from './templates.service';
export { TemplateSyncService } from './template-sync.service';
/** Read access for the team inbox: it lists and resolves the templates an agent may send inside its own tenant transaction. */
export { TemplatesRepository, type TemplateRow } from './templates.repository';
export * from './template-linter';
export * from './template-payload';
export * from './template-variables';
export { BUILDABLE_TYPES } from './template-input';
export { metaEditBlockOf } from './meta-edit-rules';
export type { FlowTemplate } from './flow-template';
