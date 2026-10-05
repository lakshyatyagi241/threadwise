import type { TemplateSummary } from '@crm/contracts';
import type { PreviewModel } from './form-model';

/** The library card shows what the list carries: the body preview. Header, footer and buttons live on the detail page. */
export function previewOfSummary(s: TemplateSummary): PreviewModel {
  return {
    auth: s.metaCategory === 'AUTHENTICATION',
    language: s.language,
    headerKind: 'none',
    headerText: '',
    headerImageUrl: null,
    body: s.bodyPreview,
    footer: '',
    buttons: [],
    expiry: null,
  };
}
