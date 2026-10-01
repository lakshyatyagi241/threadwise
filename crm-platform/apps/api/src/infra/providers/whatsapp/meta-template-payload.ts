import type { SendTemplateParams } from './whatsapp.port';

/**
 * The Cloud API body for one template message.
 *
 * The simple form: positional body variables only. A caller with header media, buttons or a carousel builds the components
 * itself (`buildSend`, WD-BCAST-017) and passes them in `params.components`, which are then sent as they are.
 * Variables are sent in key order: `{ "1": "Ana", "2": "Hoodie" }` fills `{{1}}` and `{{2}}`.
 */
export function buildTemplateMessage(params: SendTemplateParams) {
  if (params.components) {
    return {
      messaging_product: 'whatsapp',
      to: params.to.replace(/\D+/g, ''),
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.language },
        ...(params.components.length ? { components: params.components } : {}),
      },
    };
  }
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
