import {
  CATALOG_DEFAULT_CURRENCY,
  CATALOG_GRAPH_VERSION_RE,
  type CatalogSettingsResponse,
  type UpdateCatalogSettingsInput,
} from '@crm/contracts';

/** What the operator's "WhatsApp Catalog" settings form holds while it is being edited. */
export interface AdminSettingsForm {
  catalogEnabled: boolean;
  commerceEnabled: boolean;
  graphApiVersion: string;
  defaultCurrency: string;
  metaAppId: string;
  /** Write-only: blank keeps the saved secret. */
  metaAppSecret: string;
}

export const APP_ID_MAX = 60;
export const APP_SECRET_MAX = 120;

/** The form as the server last held it. The currency shows the saved value or WaDesk's default (USD). */
export function formFromSettings(s: CatalogSettingsResponse): AdminSettingsForm {
  return {
    catalogEnabled: s.catalogEnabled,
    commerceEnabled: s.commerceEnabled,
    graphApiVersion: s.graphApiVersion,
    defaultCurrency: s.defaultCurrency || CATALOG_DEFAULT_CURRENCY,
    metaAppId: s.metaAppId,
    metaAppSecret: '',
  };
}

export type AdminSettingsProblem = 'graphVersion' | 'currency';

/** WaDesk's rules: a Graph version looks like `v23.0`, a currency has three letters. Blank is allowed for both. */
export function adminSettingsProblems(form: AdminSettingsForm): AdminSettingsProblem[] {
  const out: AdminSettingsProblem[] = [];
  const v = form.graphApiVersion.trim();
  if (v !== '' && !CATALOG_GRAPH_VERSION_RE.test(v)) out.push('graphVersion');
  const c = form.defaultCurrency.trim();
  if (c !== '' && c.length !== 3) out.push('currency');
  return out;
}

/** The save request: every field is sent (an unticked toggle is a false), a blank secret keeps the saved one. */
export function buildSettingsUpdate(
  form: AdminSettingsForm,
  rowVersion: number,
): UpdateCatalogSettingsInput {
  const input: UpdateCatalogSettingsInput = {
    rowVersion,
    catalogEnabled: form.catalogEnabled,
    commerceEnabled: form.commerceEnabled,
    graphApiVersion: form.graphApiVersion.trim(),
    defaultCurrency: form.defaultCurrency.trim().toUpperCase(),
    metaAppId: form.metaAppId.trim(),
  };
  const secret = form.metaAppSecret.trim();
  if (secret) input.metaAppSecret = secret;
  return input;
}
