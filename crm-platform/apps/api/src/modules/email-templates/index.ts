/**
 * email-templates (BL-004 / E-14): reusable emails (subject, rich-text body, `{{variables}}`) for the email composer. Other domains use
 * the library only through this barrel: the inbox renders a template for a conversation, the email channel counts a sent use.
 */
export { EmailTemplatesModule } from './email-templates.module';
export { EmailTemplatesService, type ConversationFacts } from './email-templates.service';
export { EmailTemplatesReader } from './email-templates.reader';
