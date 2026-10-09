import type { TemplateSummary } from '@crm/contracts';
import { buttonToRow } from './buttons';
import type { HeaderKind, PreviewModel } from './form-model';

/**
 * A saved template as the phone shows it: every part, with `{{variable}}` tokens left as typed (WaDesk's library card and
 * detail page show the pills, not sample values).
 */
export function previewOfSummary(s: TemplateSummary): PreviewModel {
  const media = s.attachmentType !== 'none';
  const headerKind: HeaderKind = media ? s.attachmentType : s.header ? 'text' : 'none';
  return {
    auth: s.metaCategory === 'AUTHENTICATION',
    language: s.language,
    headerKind,
    headerText: headerKind === 'text' ? (s.header ?? '') : '',
    headerImageUrl: s.attachmentType === 'image' ? s.headerSampleUrl : null,
    body: s.body,
    footer: s.footer ?? '',
    buttons: s.buttons.map((b) => {
      const r = buttonToRow(b);
      return { kind: r.kind, text: r.text };
    }),
    expiry: null,
  };
}
