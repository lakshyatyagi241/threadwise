import { UNOFFICIAL_WHATSAPP_FEATURE_KEY } from '@crm/contracts';

/**
 * The platform switch for the unofficial WhatsApp engine (personal numbers paired by QR through the Node bridge, engine
 * `baileys`, inbox channel `whatsapp_qr`). Owner decision 2026-10-05: only the official WhatsApp Business API is supported,
 * the unofficial engine is off unless a platform super admin turns it on.
 *
 * The workspace learns the state from the entitlement set: `GET /v2/billing/entitlements` carries the synthetic key below only
 * while the switch is on. Everything here is pure; the hook that reads the key is in `use-unofficial-whatsapp.ts`.
 */
export const UNOFFICIAL_WHATSAPP_FEATURE: string = UNOFFICIAL_WHATSAPP_FEATURE_KEY;

/** What the operator console knows of the platform switch (read from the Node bridge settings); `unknown` = could not be read. */
export type UnofficialSwitchState = 'on' | 'off' | 'unknown';

/** The send engine of personal numbers. `waba` and `twilio` (and `sms`) are the supported ones. */
export const UNOFFICIAL_ENGINE = 'baileys';
/** The inbox channel kind of that engine. */
export const UNOFFICIAL_CHANNEL_KIND = 'whatsapp_qr';
/** The plan limit that counts personal numbers; it only matters while the switch is on. */
export const UNOFFICIAL_ONLY_LIMITS: readonly string[] = ['devices'];
/** The stable server code for a refused action. */
export const UNOFFICIAL_DISABLED_CODE = 'WA_UNOFFICIAL_DISABLED';

export const isUnofficialEngine = (engine: string | null | undefined): boolean =>
  (engine ?? '').toLowerCase() === UNOFFICIAL_ENGINE;

/** A sender key is `<engine>:<uuid>`. */
export const isUnofficialSenderKey = (key: string | null | undefined): boolean =>
  (key ?? '').toLowerCase().startsWith(`${UNOFFICIAL_ENGINE}:`);

export const isUnofficialChannelKind = (kind: string | null | undefined): boolean =>
  kind === UNOFFICIAL_CHANNEL_KIND;

export const isUnofficialOnlyLimit = (key: string): boolean => UNOFFICIAL_ONLY_LIMITS.includes(key);

/** Whether the entitlement set says the switch is on. Unknown (null) counts as off: nothing unofficial is shown until it is known. */
export const unofficialEnabledIn = (
  features: ReadonlySet<string> | readonly string[] | null | undefined,
): boolean => {
  if (!features) return false;
  return Array.isArray(features)
    ? features.includes(UNOFFICIAL_WHATSAPP_FEATURE)
    : (features as ReadonlySet<string>).has(UNOFFICIAL_WHATSAPP_FEATURE);
};

interface SenderLike {
  key: string;
  engine?: string | null | undefined;
}

const senderIsUnofficial = (s: SenderLike): boolean =>
  s.engine != null ? isUnofficialEngine(s.engine) : isUnofficialSenderKey(s.key);

/**
 * What the entitlement call has said about the switch: `pending` while it loads, `unknown` when it failed, else `on` or `off`.
 * Screens whose sender list already comes filtered by the server (campaigns) wait on `pending` instead of reading it as off, and
 * trust the server's list on `unknown`.
 */
export type UnofficialState = 'on' | 'off' | 'pending' | 'unknown';

/**
 * The senders a campaign screen may offer, or `undefined` while the answer is still pending (show a skeleton, not an empty list).
 * `off` hides the unofficial ones; `on` and `unknown` keep the list as the server filtered it (the server never lists a personal number
 * while the engine is off for the workspace, and refuses one on submit).
 */
export function offerSendersFor<T extends SenderLike>(
  senders: readonly T[] | undefined,
  state: UnofficialState,
): T[] | undefined {
  if (!senders || state === 'pending') return undefined;
  return state === 'off' ? senders.filter((s) => !senderIsUnofficial(s)) : [...senders];
}

/** The senders a create/schedule form may offer: the unofficial ones only while the switch is on. */
export function offerSenders<T extends SenderLike>(senders: readonly T[], enabled: boolean): T[] {
  return enabled ? [...senders] : senders.filter((s) => !senderIsUnofficial(s));
}

/** Sender keys a form may submit: the unofficial ones are dropped while the switch is off. */
export function submittableSenderKeys(keys: readonly string[], enabled: boolean): string[] {
  return enabled ? [...keys] : keys.filter((k) => !isUnofficialSenderKey(k));
}

/**
 * The sender a form starts on: the account's default when it may be offered, else the first offered one, else none. With the
 * switch off this never lands on an unofficial number even if that was the workspace's default.
 */
export function defaultSender<T extends SenderLike & { isDefault?: boolean }>(
  senders: readonly T[],
  enabled: boolean,
): T | null {
  const offered = offerSenders(senders, enabled);
  return offered.find((s) => s.isDefault) ?? offered[0] ?? null;
}

/**
 * The single sender a form submits (campaigns: one sender, blank = the account's default). With the switch off a blank choice is
 * made explicit as the default OFFICIAL sender, and an unofficial one (left over on a campaign saved earlier) is replaced by it,
 * so the form never submits the unofficial engine. Blank stays blank when nothing official is offered (the server then says why).
 */
export function submittableSenderKey<T extends SenderLike & { isDefault?: boolean }>(
  key: string,
  senders: readonly T[],
  enabled: boolean,
): string {
  if (enabled) return key;
  if (key && !isUnofficialSenderKey(key)) return key;
  return defaultSender(senders, false)?.key ?? '';
}

/** The inbox channels a filter or list may show: the QR (personal number) ones only while the switch is on. */
export function offerChannels<T extends { kind: string }>(
  channels: readonly T[],
  enabled: boolean,
): T[] {
  return enabled ? [...channels] : channels.filter((c) => !isUnofficialChannelKind(c.kind));
}

/** The engines a picker may offer (an "engine" select, a grouped list). */
export function offerEngines<T extends string>(engines: readonly T[], enabled: boolean): T[] {
  return enabled ? [...engines] : engines.filter((e) => !isUnofficialEngine(e));
}

/** Which label an existing record's engine gets: the unofficial one reads "disabled" while the switch is off (data is kept). */
export type EngineLabelState = 'official' | 'unofficial' | 'unofficialDisabled';
export function engineLabelState(
  engine: string | null | undefined,
  enabled: boolean,
): EngineLabelState {
  if (!isUnofficialEngine(engine)) return 'official';
  return enabled ? 'unofficial' : 'unofficialDisabled';
}

/** Whether a failed call is the platform refusing an unofficial action (translate it; never show the raw code). */
export const isUnofficialDisabledError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === UNOFFICIAL_DISABLED_CODE;
