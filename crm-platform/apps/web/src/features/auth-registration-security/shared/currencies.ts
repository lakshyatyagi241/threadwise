import type { ComboboxOption } from './combobox';

const FALLBACK = [
  'AED',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'EUR',
  'GBP',
  'INR',
  'JPY',
  'SAR',
  'SGD',
  'USD',
  'ZAR',
];

/** ISO 4217 codes the browser knows, each with its name in the UI language: "USD - US Dollar". */
export function currencyOptions(locale: string): ComboboxOption[] {
  const fn = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const codes = typeof fn === 'function' ? fn.call(Intl, 'currency') : FALLBACK;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'currency' });
  } catch {
    names = null;
  }
  return codes.map((code) => {
    const name = names?.of(code);
    const label = name && name !== code ? `${code} - ${name}` : code;
    return { value: code, label, search: label.toLowerCase() };
  });
}
