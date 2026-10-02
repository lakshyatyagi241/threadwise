/**
 * message-templates (TPL): WhatsApp template authoring and submission. This slice holds the pure rules (placeholders, the Meta
 * create payload, the pre-submit linter); the persistence service, controller and worker jobs build on it.
 */
export * from './template-linter';
export * from './template-payload';
export * from './template-variables';
