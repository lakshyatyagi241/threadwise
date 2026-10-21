import type { InboxTemplateOption } from '@crm/contracts';

/** What a person has typed for each `{{n}}` of a template's body, by slot key. */
export type TemplateValues = Record<string, string>;

/**
 * The text with each `{{key}}` replaced by what was typed for it. A slot with nothing typed yet keeps its `{{key}}`, so the preview shows
 * what is still missing instead of a gap.
 */
export function fillTokens(text: string, values: TemplateValues): string {
  return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (whole, key: string) => {
    // Own properties only: a token named "constructor" must not find something on the object's prototype.
    const typed = Object.prototype.hasOwnProperty.call(values, key) ? values[key]?.trim() : '';
    return typed ? typed : whole;
  });
}

/**
 * WhatsApp refuses a variable that holds a new line, a tab, or more than three spaces in a row (error 132018), so the app says so before
 * the request instead of after it. Null when the value is fine (or empty: that is "not filled in yet", not "invalid").
 */
export const valueProblem = (value: string): 'format' | null =>
  /[\n\r\t]| {4,}/.test(value) ? 'format' : null;

/** The three printed parts of a template with the typed values put in (the header and footer have no variables the app fills). */
export function renderTemplate(template: InboxTemplateOption, values: TemplateValues) {
  return {
    // A body written with a blank line before or after it would leave a gap in the bubble.
    header: template.header?.trim() || null,
    body: fillTokens(template.body, values).trim(),
    footer: template.footer?.trim() || null,
  };
}

const typedValue = (values: TemplateValues, key: string): string =>
  Object.prototype.hasOwnProperty.call(values, key) ? (values[key] ?? '') : '';

/** Every slot of the body has something typed that WhatsApp accepts: the template can be sent. */
export const allSlotsFilled = (template: InboxTemplateOption, values: TemplateValues): boolean =>
  template.slots.every((slot) => {
    const value = typedValue(values, slot.key);
    return value.trim() !== '' && valueProblem(value) === null;
  });

/** The values that count, for telling whether two attempts to send are the same message. */
export const valuesKey = (template: InboxTemplateOption, values: TemplateValues): string =>
  JSON.stringify(template.slots.map((slot) => [slot.key, typedValue(values, slot.key).trim()]));

/** The category as the picker writes it ("marketing"): the API sends it in capitals. */
export const categoryWord = (category: string): string => category.toLowerCase();
