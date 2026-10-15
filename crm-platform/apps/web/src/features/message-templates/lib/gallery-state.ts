import type { TemplateGalleryItem } from '@crm/contracts';
import { buttonToRow } from './buttons';
import { initialState, type FormState, type HeaderKind } from './form-model';
import { syncSlots } from './variables';

const HEADER_FORMATS: Readonly<Record<string, HeaderKind>> = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  DOCUMENT: 'document',
};

/**
 * A default template as the new-template form starts from it: its name, Meta category, header, body with the sample value of each
 * variable, footer and buttons. The number it is submitted through and a header picture are the author's to choose.
 */
export function galleryToState(g: TemplateGalleryItem, connectionId = ''): FormState {
  const part = (type: string) => g.components.find((c) => c.type === type);
  const header = part('HEADER');
  const body = part('BODY');
  const foot = part('FOOTER');
  const buttons = part('BUTTONS');

  const headerKind: HeaderKind = header
    ? (HEADER_FORMATS[(header.format ?? 'TEXT').toUpperCase()] ?? 'none')
    : 'none';
  const headerText = headerKind === 'text' ? (header?.text ?? '') : '';
  const bodyText = body?.text ?? '';

  const samples = ((body?.example as { body_text?: unknown } | undefined)?.body_text ?? [
    [],
  ]) as unknown;
  const first =
    Array.isArray(samples) && Array.isArray(samples[0]) ? (samples[0] as unknown[]) : [];
  const bodySlots = syncSlots(bodyText, {});
  Object.keys(bodySlots).forEach((token, i) => {
    // Meta lists examples by variable number; a named variable falls back to its place in the text.
    const sample = first[/^\d+$/.test(token) ? Number(token) - 1 : i];
    if (typeof sample === 'string') bodySlots[token] = { key: token, example: sample };
  });

  return {
    ...initialState(connectionId),
    name: g.id,
    metaCategory: g.template_category,
    headerKind,
    headerText,
    headerSlots: syncSlots(headerText, {}),
    body: bodyText,
    bodySlots,
    footer: foot?.text ?? '',
    buttons: (buttons?.buttons ?? []).map((b) => buttonToRow(b)),
  };
}
