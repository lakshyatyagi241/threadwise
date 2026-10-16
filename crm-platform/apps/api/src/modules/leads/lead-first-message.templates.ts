import type { TemplateShape } from '../../infra/providers/whatsapp/meta-send-payload';
import { tokensOf, type TemplateRow } from '../message-templates';
import type { TemplateFacts } from './lead-first-reply.rules';

/** The stored template as the Cloud API payload builder reads it. */
export function shapeOf(t: TemplateRow): TemplateShape & { headerLocation: unknown } {
  return {
    templateName: t.templateName,
    language: t.language,
    templateType: t.templateType,
    templateBody: t.templateBody,
    header: t.header,
    attachmentType: t.attachmentType,
    attachmentFile: t.attachmentFile,
    parameterFormat: t.parameterFormat,
    variableMap: t.variableMap,
    buttons: t.buttons,
    carouselData: null,
    headerLocation: t.headerLocation,
  };
}

/** What `templateProblem` looks at: the tokens of the header and of each button's link are read from the stored text here. */
export function factsOf(t: TemplateRow): TemplateFacts {
  const buttons = Array.isArray(t.buttons) ? (t.buttons as Array<Record<string, unknown>>) : [];
  return {
    status: t.status,
    metaStatus: t.metaStatus,
    pausedUntil: t.pausedUntil,
    templateType: t.templateType,
    attachmentType: t.attachmentType,
    header: t.header,
    parameterFormat: t.parameterFormat,
    buttons: t.buttons,
    headerTokens: t.header ? tokensOf(t.header) : [],
    buttonUrlTokens: buttons.map((b) => (typeof b.url === 'string' ? tokensOf(b.url) : [])),
  };
}
