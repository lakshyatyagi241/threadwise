import { ERROR_CODES, updateLscPlatformConfigSchema } from '@crm/contracts';
import type { LscPlatformConfig, LscRunStatus, UpdateLscPlatformConfigInput } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type FieldKey = keyof UpdateLscPlatformConfigInput;
export const FIELD_KEYS: readonly FieldKey[] = [
  'platformEnabled',
  'model',
  'scoresPerHour',
  'retentionDays',
];

/** The whole-number limits. Mirrors the contract schema (a test proves the two agree). */
export const LIMIT_RANGES = {
  scoresPerHour: { min: 0, max: 100_000 },
  retentionDays: { min: 7, max: 730 },
} as const;

/** The picker's value for "a model that is not on the list". */
export const OTHER_MODEL = '__other__';

/** The form's working copy. Numbers the operator types stay text until they are validated. */
export interface ConfigDraft {
  platformEnabled: boolean;
  /** A listed model id, or OTHER_MODEL when `customModel` is used. */
  modelPick: string;
  customModel: string;
  scoresPerHour: string;
  retentionDays: string;
}

export function draftFromConfig(config: LscPlatformConfig): ConfigDraft {
  const listed = config.models.some((m) => m.id === config.model);
  return {
    platformEnabled: config.platformEnabled,
    modelPick: listed ? config.model : OTHER_MODEL,
    customModel: listed ? '' : config.model,
    scoresPerHour: String(config.scoresPerHour),
    retentionDays: String(config.retentionDays),
  };
}

export type FieldProblem =
  | { kind: 'integer' }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'modelId' }
  | { kind: 'invalid' };
export type FieldErrors = Partial<Record<FieldKey, FieldProblem>>;

export type DiffResult =
  | { ok: true; body: UpdateLscPlatformConfigInput; changed: FieldKey[] }
  | { ok: false; errors: FieldErrors; changed: FieldKey[] };

const INT_FIELDS = ['scoresPerHour', 'retentionDays'] as const;

/** The model id the draft stands for. */
export function draftModel(draft: ConfigDraft): string {
  return draft.modelPick === OTHER_MODEL ? draft.customModel.trim() : draft.modelPick;
}

/**
 * The PATCH body for what the operator changed, or the field problems. Only changed fields are sent (the API takes a partial body
 * and refuses an empty one), and the contract schema is the validator so the form can never disagree with the server.
 */
export function diffConfig(saved: LscPlatformConfig, draft: ConfigDraft): DiffResult {
  const body: UpdateLscPlatformConfigInput = {};
  const errors: FieldErrors = {};
  const changed: FieldKey[] = [];

  if (draft.platformEnabled !== saved.platformEnabled) {
    body.platformEnabled = draft.platformEnabled;
    changed.push('platformEnabled');
  }
  const model = draftModel(draft);
  if (model !== saved.model) {
    body.model = model;
    changed.push('model');
  }
  for (const key of INT_FIELDS) {
    const text = draft[key].trim();
    if (text === String(saved[key])) continue;
    changed.push(key);
    if (!/^\d+$/.test(text)) errors[key] = { kind: 'integer' };
    else body[key] = Number(text);
  }

  if (changed.length === 0) return { ok: true, body, changed };
  const parsed = updateLscPlatformConfigSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as FieldKey | undefined;
      if (!key || errors[key]) continue;
      errors[key] = problemOf(key, issue.code);
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors, changed };
  return { ok: true, body: parsed.success ? parsed.data : body, changed };
}

function problemOf(key: FieldKey, code: string): FieldProblem {
  if (key === 'model') return { kind: 'modelId' };
  if (key === 'scoresPerHour' || key === 'retentionDays') {
    return code === 'too_small' || code === 'too_big'
      ? { kind: 'range', ...LIMIT_RANGES[key] }
      : { kind: 'integer' };
  }
  return { kind: 'invalid' };
}

/** The API's `errors[].path` list as per-field problems; paths that are not form fields are ignored. */
export function fieldErrorsFromApi(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  const out: FieldErrors = {};
  for (const e of error.fieldErrors) {
    const key = e.path.split('.')[0] as FieldKey;
    if (FIELD_KEYS.includes(key) && !out[key]) out[key] = { kind: 'invalid' };
  }
  return out;
}

export type ErrorKind =
  'forbidden' | 'validation' | 'notFound' | 'network' | 'request' | 'unexpected';

/** Which message to show for a failed call. Branches on the stable code and status, never on the server's wording. */
export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.code === ERROR_CODES.VALIDATION_FAILED) return 'validation';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 422) return 'validation';
  return error.status >= 500 ? 'unexpected' : 'request';
}

/** What the operator must acknowledge before the change is sent. */
export function riskOf(saved: LscPlatformConfig, body: UpdateLscPlatformConfigInput) {
  return {
    turningOn: body.platformEnabled === true && !saved.platformEnabled,
    turningOff: body.platformEnabled === false && saved.platformEnabled,
  };
}

/**
 * Fraction digits that show a USD amount without rounding a real cost to zero: a score costs about 0.0001 USD, so amounts under
 * one cent need six places, and under a millionth the full eight the ledger keeps. Zero shows as plain cents.
 */
export function usdDigits(value: string | number): number {
  const n = Math.abs(Number(value));
  if (!Number.isFinite(n) || n === 0) return 2;
  if (n >= 1) return 2;
  if (n >= 0.01) return 4;
  if (n >= 0.000001) return 6;
  return 8;
}

/** Cost per million tokens for the picker: whole cents when they are enough, else up to three places. */
export function pricePerMillionDigits(value: number): { min: number; max: number } {
  return Number.isInteger(value * 100) ? { min: 2, max: 2 } : { min: 2, max: 3 };
}

/** Total tokens of a run or window. */
export const totalTokens = (a: { promptTokens: number; completionTokens: number }) =>
  a.promptTokens + a.completionTokens;

/** The run statuses the filter offers, in the order the log shows them. */
export const STATUS_FILTERS: readonly LscRunStatus[] = ['ok', 'kept', 'failed', 'skipped'];

/** Reason codes the API writes into a run's `error`. Anything else is shown as the code itself. */
export const KNOWN_RUN_REASONS = [
  'platform_off',
  'not_enabled',
  'contact_gone',
  'manual_score',
  'no_key',
  'token_allowance',
  'hourly_limit',
  'auth',
  'rate_limited',
  'provider',
  'timeout',
  'bad_response',
] as const;

export function knownReason(error: string | null): (typeof KNOWN_RUN_REASONS)[number] | null {
  return KNOWN_RUN_REASONS.find((r) => r === error) ?? null;
}

/** Duration in seconds with one decimal, or milliseconds when under one second. */
export function durationText(ms: number | null): { unit: 'ms' | 's'; value: number } | null {
  if (ms === null) return null;
  return ms < 1000 ? { unit: 'ms', value: ms } : { unit: 's', value: Math.round(ms / 100) / 10 };
}
