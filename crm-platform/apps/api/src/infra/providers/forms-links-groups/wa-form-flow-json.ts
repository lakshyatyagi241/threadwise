import type { WaFormAudienceType, WaFormDefinition, WaFormFieldKind } from '@crm/contracts';

/**
 * Builds Meta WhatsApp Flow JSON (v5.1, no-endpoint / self-contained) from a `wa_forms.definition_json` (WFL;
 * docs/wadesk-port/inventory/forms-links-groups.md TW-WFL-004). Screen ids are spreadsheet-letter-encoded
 * (`SCREEN_A`, `SCREEN_B`, ...) because Meta disallows digits in screen ids. Every field is wrapped in a `Form`
 * component named `"form"` — required for Meta to capture values at all. No `data_api_version` key: adding one
 * forces `endpoint_uri` and Meta rejects publish (error 139002/4233024) for a flow that has no callback server.
 */

const FLOW_VERSION = '5.1';

function screenLetter(index: number): string {
  // A, B, ..., Z, AA, AB, ... (spreadsheet-column style; Reference never needs more than a handful of screens).
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `SCREEN_${out}`;
}

const CHOICE_KINDS: readonly WaFormFieldKind[] = ['dropdown', 'radio_buttons', 'checkbox'];

function fieldComponent(field: {
  id: string;
  kind: WaFormFieldKind;
  label: string;
  required: boolean;
  placeholder?: string;
  helperText?: string;
  options?: string[];
}): Record<string, unknown> {
  const base = { name: field.id, label: field.label, required: field.required };
  switch (field.kind) {
    case 'heading':
      return { type: 'TextHeading', text: field.label };
    case 'paragraph':
      return { type: 'TextArea', ...base, 'helper-text': field.helperText };
    case 'date':
      return { type: 'DatePicker', ...base, 'helper-text': field.helperText };
    case 'dropdown':
    case 'radio_buttons':
    case 'checkbox': {
      const type =
        field.kind === 'dropdown'
          ? 'Dropdown'
          : field.kind === 'radio_buttons'
            ? 'RadioButtonsGroup'
            : 'CheckboxGroup';
      return {
        type,
        ...base,
        'data-source': (field.options ?? []).map((opt) => ({ id: opt, title: opt })),
      };
    }
    case 'email':
    case 'phone_number':
    case 'number':
    case 'short_text':
    default: {
      const inputType =
        field.kind === 'email'
          ? 'email'
          : field.kind === 'phone_number'
            ? 'phone'
            : field.kind === 'number'
              ? 'number'
              : 'text';
      return { type: 'TextInput', ...base, 'input-type': inputType, 'helper-text': field.helperText };
    }
  }
}

/** `audience_type` -> Meta's Flow category enum (TW-WFL-004). */
export function mapAudienceToMetaCategory(audienceType: WaFormAudienceType): string {
  switch (audienceType) {
    case 'lead_capture':
      return 'LEAD_GENERATION';
    case 'survey':
      return 'SURVEY';
    case 'appointment_booking':
      return 'APPOINTMENT_BOOKING';
    case 'customer_support':
      return 'CUSTOMER_SUPPORT';
    case 'sign_up':
      return 'SIGN_UP';
    default:
      return 'OTHER';
  }
}

export function buildMetaFlowJson(definition: WaFormDefinition, sendButtonLabel: string): object {
  const screenIds = definition.screens.map((_, i) => screenLetter(i));
  const payloadSoFar: Record<string, string> = {};

  const screens = definition.screens.map((screen, index) => {
    const isLast = index === definition.screens.length - 1;
    for (const field of screen.fields) {
      if (field.kind !== 'heading') payloadSoFar[field.id] = `\${form.${field.id}}`;
    }
    const footer = {
      type: 'Footer',
      label: isLast ? sendButtonLabel : 'Next',
      'on-click-action': isLast
        ? { name: 'complete', payload: { ...payloadSoFar } }
        : { name: 'navigate', next: { type: 'screen', name: screenIds[index + 1] }, payload: { ...payloadSoFar } },
    };
    return {
      id: screenIds[index],
      title: screen.title || 'Form',
      terminal: isLast,
      data: {},
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'form',
            children: [...screen.fields.map(fieldComponent), footer],
          },
        ],
      },
    };
  });

  return { version: FLOW_VERSION, screens };
}

export { CHOICE_KINDS as WA_FORM_CHOICE_KINDS_FOR_FLOW_JSON };
