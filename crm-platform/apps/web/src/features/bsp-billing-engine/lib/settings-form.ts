import {
  isCreditCurrency,
  normalizeCurrencyInput,
  normalizeGraphVersion,
  type BspSettingsResponse,
  type UpdateBspSettingsInput,
} from '@crm/contracts';

/** What the connection form edits. The token is write-only: empty here means "keep the stored one". */
export interface SettingsDraft {
  businessId: string;
  extendedCreditId: string;
  systemUserToken: string;
  clearToken: boolean;
  graphVersion: string;
  ratesEndpoint: string;
  autoAttach: boolean;
  autoAttachCurrency: string;
  baseCurrency: string;
}

export const toDraft = (s: BspSettingsResponse): SettingsDraft => ({
  businessId: s.businessId,
  extendedCreditId: s.extendedCreditId,
  systemUserToken: '',
  clearToken: false,
  graphVersion: s.graphVersion,
  ratesEndpoint: s.ratesEndpoint,
  autoAttach: s.autoAttach,
  autoAttachCurrency: s.autoAttachCurrency,
  baseCurrency: s.baseCurrency,
});

/** The request body: a token only when one was typed or removal was asked for, so the stored one is never overwritten by accident. */
export function toPayload(d: SettingsDraft): UpdateBspSettingsInput {
  const token = d.systemUserToken.trim();
  return {
    businessId: d.businessId.trim(),
    extendedCreditId: d.extendedCreditId.trim(),
    ...(token ? { systemUserToken: token } : d.clearToken ? { clearToken: true } : {}),
    graphVersion: d.graphVersion.trim(),
    ratesEndpoint: d.ratesEndpoint.trim(),
    autoAttach: d.autoAttach,
    autoAttachCurrency: d.autoAttachCurrency,
    baseCurrency: d.baseCurrency,
  };
}

export type SettingsProblem =
  'businessId' | 'graphVersion' | 'ratesEndpoint' | 'autoAttachCurrency' | 'baseCurrency';

/** The same rules the server applies, so a mistake is shown before the request. The server stays the authority. */
export function validateDraft(d: SettingsDraft): SettingsProblem[] {
  const out: SettingsProblem[] = [];
  if (d.businessId.trim().length > 64) out.push('businessId');
  if (d.graphVersion.trim() && normalizeGraphVersion(d.graphVersion) === null)
    out.push('graphVersion');
  if (d.ratesEndpoint.trim() && !/^https:\/\/[^\s/?#]+[^\s]*$/i.test(d.ratesEndpoint.trim())) {
    out.push('ratesEndpoint');
  }
  const auto = normalizeCurrencyInput(d.autoAttachCurrency);
  if (auto && !isCreditCurrency(auto)) out.push('autoAttachCurrency');
  if (normalizeCurrencyInput(d.baseCurrency).length !== 3) out.push('baseCurrency');
  return out;
}

export const isDirty = (d: SettingsDraft, s: BspSettingsResponse): boolean => {
  const base = toDraft(s);
  return (Object.keys(base) as Array<keyof SettingsDraft>).some((k) => base[k] !== d[k]);
};
