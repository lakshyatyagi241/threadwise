import type {
  SaveStoreGatewayInput,
  StoreGateway,
  StoreGatewayCredential,
  StoreGatewayDriver,
  StoreGatewayField,
  StoreGatewayMode,
  StoreGatewayTestResult,
} from '@crm/contracts';

/**
 * The configure form of one gateway. It is generated from the driver's `fields`; what the server stores never comes back, so the form
 * can only hold what the person typed this time. A blank box keeps the saved value, a ticked "clear" removes it, a typed value
 * replaces it. A mask the server showed is never sent back as if it were a value.
 */
export interface GatewayFormState {
  /** What was typed, by field key. Never prefilled. */
  values: Record<string, string>;
  /** Field keys the person asked to remove from the saved row. */
  clear: string[];
  mode: StoreGatewayMode;
  active: boolean;
}

/** A secret is masked in the UI: a password field or the one that authenticates provider notifications. */
export function isSecretField(field: StoreGatewayField): boolean {
  return field.type === 'password' || field.webhook;
}

/** The server's view of one saved field: whether it holds a value and its mask. */
export function storedCredential(
  saved: StoreGateway | undefined,
  key: string,
): StoreGatewayCredential | undefined {
  return saved?.credentials.find((c) => c.key === key);
}

export function hasStoredValue(saved: StoreGateway | undefined, key: string): boolean {
  return storedCredential(saved, key)?.hasValue === true;
}

/** Empty form for a new row; for a saved one only mode and active come from it. No value is ever prefilled. */
export function initialForm(
  driver: StoreGatewayDriver,
  saved: StoreGateway | undefined,
): GatewayFormState {
  const values: Record<string, string> = {};
  for (const f of driver.fields) values[f.key] = '';
  return { values, clear: [], mode: saved?.mode ?? 'live', active: saved ? saved.active : true };
}

/** Typing a value takes the field off the clear list (replacing wins over removing). */
export function withValue(form: GatewayFormState, key: string, value: string): GatewayFormState {
  return {
    ...form,
    values: { ...form.values, [key]: value },
    clear: value.trim() === '' ? form.clear : form.clear.filter((k) => k !== key),
  };
}

/** Ticking "clear" empties what was typed in the box; unticking just removes the key. */
export function withClear(form: GatewayFormState, key: string, on: boolean): GatewayFormState {
  const rest = form.clear.filter((k) => k !== key);
  return on
    ? { ...form, clear: [...rest, key], values: { ...form.values, [key]: '' } }
    : { ...form, clear: rest };
}

/** True when the text is only what the server printed as a mask (a run of bullets, maybe followed by the last four characters). */
export function looksLikeMask(value: string, masked: string | null | undefined): boolean {
  const v = value.trim();
  if (!v) return false;
  if (masked && v === masked.trim()) return true;
  return /^[•●·]{3,}/.test(v);
}

/** The value to send for a typed field: trimmed, and nothing when blank or when it is a mask pasted back. */
function typedValue(form: GatewayFormState, saved: StoreGateway | undefined, key: string): string {
  const raw = (form.values[key] ?? '').trim();
  if (!raw) return '';
  if (looksLikeMask(raw, storedCredential(saved, key)?.masked)) return '';
  return raw;
}

/**
 * The PUT body. `storefrontId` is the shop of an override and is left out for the workspace row. Only fields of the driver that hold
 * typed text are sent as credentials; `clear` lists saved fields to remove and never a field that is also replaced.
 */
export function buildSaveBody(
  driver: StoreGatewayDriver,
  saved: StoreGateway | undefined,
  form: GatewayFormState,
  storefrontId: string | undefined,
): SaveStoreGatewayInput {
  const credentials: Record<string, string> = {};
  for (const f of driver.fields) {
    const v = typedValue(form, saved, f.key);
    if (v) credentials[f.key] = v;
  }
  const clear = driver.fields
    .map((f) => f.key)
    .filter((k) => form.clear.includes(k) && hasStoredValue(saved, k) && !(k in credentials));

  const body: SaveStoreGatewayInput = { mode: form.mode, active: form.active };
  if (storefrontId) body.storefrontId = storefrontId;
  if (Object.keys(credentials).length > 0) body.credentials = credentials;
  if (clear.length > 0) body.clear = clear;
  if (saved) body.rowVersion = saved.rowVersion;
  return body;
}

export type GatewayProblem = { key: string; kind: 'required' | 'option' };

/**
 * What blocks a save. A first save needs every required field. A saved row needs a replacement for a required field that is being
 * cleared. A select must hold one of its options.
 */
export function validateForm(
  driver: StoreGatewayDriver,
  saved: StoreGateway | undefined,
  form: GatewayFormState,
): GatewayProblem[] {
  const problems: GatewayProblem[] = [];
  for (const f of driver.fields) {
    const typed = typedValue(form, saved, f.key);
    if (typed && f.type === 'select' && f.options && !f.options.includes(typed)) {
      problems.push({ key: f.key, kind: 'option' });
      continue;
    }
    if (!f.required || typed) continue;
    const keeps = hasStoredValue(saved, f.key) && !form.clear.includes(f.key);
    if (!keeps) problems.push({ key: f.key, kind: 'required' });
  }
  return problems;
}

/** Did the person change anything compared with the saved row? Used to leave "Save" off an untouched form. */
export function isDirty(
  driver: StoreGatewayDriver,
  saved: StoreGateway | undefined,
  form: GatewayFormState,
): boolean {
  if (!saved) return true;
  if (form.mode !== saved.mode || form.active !== saved.active) return true;
  const body = buildSaveBody(driver, saved, form, undefined);
  return body.credentials !== undefined || body.clear !== undefined;
}

/** The server's field-error path for a credential (`credentials.key_id`) down to the field key. */
export function credentialErrorKey(path: string): string {
  return path.replace(/^credentials\./, '');
}

// --- the test connection result --------------------------------------------------------------------------------------------------

export type TestOutcome =
  | { kind: 'verified' }
  /** Only the required fields were checked: this gateway has no cheap auth call, so a payment is the real test. */
  | { kind: 'fieldsOnly' }
  | { kind: 'missing'; fields: string[] }
  | { kind: 'rejected'; detail: string };

/**
 * Said honestly: `verified` is the only result that proves the provider accepted the keys. `fields` with ok means the keys are
 * present, nothing more. A failed result lists the missing fields (by label when the driver is known).
 */
export function testOutcome(
  result: StoreGatewayTestResult,
  driver: StoreGatewayDriver | undefined,
): TestOutcome {
  const label = (key: string) => driver?.fields.find((f) => f.key === key)?.label ?? key;
  if (result.ok) return result.level === 'verified' ? { kind: 'verified' } : { kind: 'fieldsOnly' };
  if (result.missing.length > 0) return { kind: 'missing', fields: result.missing.map(label) };
  return { kind: 'rejected', detail: result.message };
}
