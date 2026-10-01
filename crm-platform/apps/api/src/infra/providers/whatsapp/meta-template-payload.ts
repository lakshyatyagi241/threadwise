import type { SendTemplateParams } from './whatsapp.port';

/**
 * The Cloud API body for one template message.
 *
 * Covers text templates with positional body variables, which is what the broadcast sender needs first. Header media,
 * buttons and carousel components are added by the broadcast payload builder (TW-BCAST-017), not here.
 * Variables are sent in key order: `{ "1": "Ana", "2": "Hoodie" }` fills `{{1}}` and `{{2}}`.
 */
export function buildTemplateMessage(params: SendTemplateParams) {
  const values = Object.keys(params.variables)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((k) => params.variables[k] ?? '');
  return {
    messaging_product: 'whatsapp',
    to: params.to.replace(/\D+/g, ''),
    type: 'template',
    template: {
      name: params.templateName,
      language: { code: params.language },
      ...(values.length
        ? {
            components: [
              { type: 'body', parameters: values.map((text) => ({ type: 'text', text })) },
            ],
          }
        : {}),
    },
  };
}
