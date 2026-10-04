import type { SaveShopInput, WizardResponse } from '@crm/contracts';

export type WizardShop = WizardResponse['shops'][number];
export type WizardDevice = WizardResponse['devices'][number];

/** Which view `/connect?platform=wa-store` shows (WD-STORE-003): `?shop=` of a known shop edits it, `?action=add` or no shops adds. */
export type WizardMode = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; shop: WizardShop };

export function resolveMode(
  params: { shop?: string | null; action?: string | null },
  shops: readonly WizardShop[],
): WizardMode {
  const edit = params.shop ? shops.find((s) => s.id === params.shop) : undefined;
  if (edit) return { kind: 'edit', shop: edit };
  if (params.action === 'add' || shops.length === 0) return { kind: 'add' };
  return { kind: 'list' };
}

export interface WizardForm {
  shopName: string;
  customDomain: string;
  /** '' is the official API (no bound device). */
  deviceId: string;
}

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

export type WizardProblem = 'nameRequired' | 'nameTooLong' | 'domainInvalid' | 'domainTooLong';

export function validateWizard(form: WizardForm): Partial<Record<keyof WizardForm, WizardProblem>> {
  const out: Partial<Record<keyof WizardForm, WizardProblem>> = {};
  const name = form.shopName.trim();
  if (name === '') out.shopName = 'nameRequired';
  else if (name.length > 191) out.shopName = 'nameTooLong';
  const domain = form.customDomain.trim();
  if (domain.length > 191) out.customDomain = 'domainTooLong';
  else if (domain !== '' && !DOMAIN_RE.test(domain)) out.customDomain = 'domainInvalid';
  return out;
}

/**
 * The device preselected when the form opens: the shop's own device if it still exists, else the first connected one,
 * else the official API (empty) when the workspace has it, else nothing.
 */
export function defaultDeviceId(
  shop: WizardShop | null,
  devices: readonly WizardDevice[],
  hasOfficial: boolean,
): string {
  if (shop?.deviceId && devices.some((d) => d.id === shop.deviceId)) return shop.deviceId;
  if (shop && shop.deviceId === null && hasOfficial) return '';
  return devices[0]?.id ?? '';
}

/**
 * The wizard response says whether any sender exists, not which kind. The official number is offered when no device is
 * connected (then it is the only sender) or when a shop already sends from it (no device bound, yet a number resolved).
 */
export function hasOfficialSender(
  wizard: Pick<WizardResponse, 'hasSender' | 'devices' | 'shops'>,
): boolean {
  if (!wizard.hasSender) return false;
  if (wizard.devices.length === 0) return true;
  return wizard.shops.some((s) => s.deviceId === null && s.sendingLabel !== null);
}

export function toSaveInput(form: WizardForm, shopId?: string): SaveShopInput {
  const domain = form.customDomain.trim();
  return {
    ...(shopId ? { shopId } : {}),
    shopName: form.shopName.trim(),
    customDomain: domain === '' ? null : domain,
    deviceId: form.deviceId === '' ? null : form.deviceId,
  };
}

export function initialWizardForm(
  shop: WizardShop | null,
  devices: readonly WizardDevice[],
  hasOfficial: boolean,
  workspaceName: string,
): WizardForm {
  return {
    shopName: shop?.shopName?.trim() || workspaceName,
    customDomain: shop?.customDomain ?? '',
    deviceId: defaultDeviceId(shop, devices, hasOfficial),
  };
}

/** The label of a device card: its name, else "Device <short id>". */
export function deviceTitle(device: WizardDevice, fallback: string): string {
  return device.label.trim() || `${fallback} ${device.id.slice(0, 6)}`;
}
