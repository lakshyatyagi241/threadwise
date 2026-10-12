import { ERROR_CODES, FAQ_LIMITS, updateFaqPlatformConfigSchema } from '@crm/contracts';
import type {
  FaqPlatformConfig,
  FaqPlatformOverview,
  UpdateFaqPlatformConfigInput,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** How often the overview is re-read while vectors are still being made. */
export const POLL_MS = 5000;

export type FieldKey = keyof UpdateFaqPlatformConfigInput;
export const FIELD_KEYS: readonly FieldKey[] = [
  'engineEnabled',
  'embeddingModel',
  'generationModel',
  'defaultThreshold',
  'maxFaqs',
  'maxVariationsPerFaq',
  'semanticPerHour',
  'verifyEnabled',
  'verifyModel',
  'verifyPerHour',
];

/** The form's working copy. Numbers the operator types stay text until they are validated. */
export interface ConfigDraft {
  engineEnabled: boolean;
  embeddingModel: string;
  generationModel: string;
  /** The default threshold is the sensitivity of the model in use (on) or a fixed number (off). */
  followModel: boolean;
  defaultThreshold: number;
  maxFaqs: string;
  maxVariationsPerFaq: string;
  semanticPerHour: string;
  verifyEnabled: boolean;
  verifyModel: string;
  verifyPerHour: string;
}

export const THRESHOLD_MIN = FAQ_LIMITS.thresholdMin;
export const THRESHOLD_MAX = FAQ_LIMITS.thresholdMax;

/** The whole-number limits. Mirrors the contract schema (a test proves the two agree). */
export const LIMIT_RANGES = {
  maxFaqs: { min: 1, max: 20_000 },
  maxVariationsPerFaq: { min: 1, max: 500 },
  semanticPerHour: { min: 0, max: 100_000 },
  verifyPerHour: { min: 0, max: 100_000 },
} as const;

export function draftFromConfig(config: FaqPlatformConfig): ConfigDraft {
  return {
    engineEnabled: config.engineEnabled,
    embeddingModel: config.embeddingModel,
    generationModel: config.generationModel,
    followModel: !config.defaultThresholdCustom,
    defaultThreshold: config.defaultThreshold,
    maxFaqs: String(config.maxFaqs),
    maxVariationsPerFaq: String(config.maxVariationsPerFaq),
    semanticPerHour: String(config.semanticPerHour),
    verifyEnabled: config.verifyEnabled,
    verifyModel: config.verifyModel,
    verifyPerHour: String(config.verifyPerHour),
  };
}

export type FieldProblem =
  | { kind: 'integer' }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'modelId' }
  | { kind: 'invalid' };
export type FieldErrors = Partial<Record<FieldKey, FieldProblem>>;

const sameThreshold = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export type DiffResult =
  | { ok: true; body: UpdateFaqPlatformConfigInput; changed: FieldKey[] }
  | { ok: false; errors: FieldErrors; changed: FieldKey[] };

const INT_FIELDS = ['maxFaqs', 'maxVariationsPerFaq', 'semanticPerHour', 'verifyPerHour'] as const;

/**
 * The PATCH body for what the operator changed, or the field problems. Only changed fields are sent (the API takes a partial body
 * and refuses an empty one), and the contract schema is the validator so the form can never disagree with the server.
 */
export function diffConfig(saved: FaqPlatformConfig, draft: ConfigDraft): DiffResult {
  const body: UpdateFaqPlatformConfigInput = {};
  const errors: FieldErrors = {};
  const changed: FieldKey[] = [];

  if (draft.engineEnabled !== saved.engineEnabled) {
    body.engineEnabled = draft.engineEnabled;
    changed.push('engineEnabled');
  }
  if (draft.embeddingModel !== saved.embeddingModel) {
    body.embeddingModel = draft.embeddingModel as UpdateFaqPlatformConfigInput['embeddingModel'];
    changed.push('embeddingModel');
  }
  const model = draft.generationModel.trim();
  if (model !== saved.generationModel) {
    body.generationModel = model;
    changed.push('generationModel');
  }
  if (draft.verifyEnabled !== saved.verifyEnabled) {
    body.verifyEnabled = draft.verifyEnabled;
    changed.push('verifyEnabled');
  }
  const verifyModel = draft.verifyModel.trim();
  if (verifyModel !== saved.verifyModel) {
    body.verifyModel = verifyModel;
    changed.push('verifyModel');
  }
  if (draft.followModel) {
    // Handing the default back to the model: nothing to send unless a fixed number is saved now.
    if (saved.defaultThresholdCustom) {
      body.defaultThreshold = null;
      changed.push('defaultThreshold');
    }
  } else if (
    saved.defaultThresholdCustom === false ||
    !sameThreshold(draft.defaultThreshold, saved.defaultThreshold)
  ) {
    body.defaultThreshold = draft.defaultThreshold;
    changed.push('defaultThreshold');
  }
  for (const key of INT_FIELDS) {
    const text = draft[key].trim();
    if (text === String(saved[key])) continue;
    changed.push(key);
    if (!/^\d+$/.test(text)) errors[key] = { kind: 'integer' };
    else body[key] = Number(text);
  }

  if (changed.length === 0) return { ok: true, body, changed };
  const parsed = updateFaqPlatformConfigSchema.safeParse(body);
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
  if (key === 'generationModel' || key === 'verifyModel') return { kind: 'modelId' };
  if (key === 'defaultThreshold') {
    return { kind: 'range', min: THRESHOLD_MIN, max: THRESHOLD_MAX };
  }
  if (
    key === 'maxFaqs' ||
    key === 'maxVariationsPerFaq' ||
    key === 'semanticPerHour' ||
    key === 'verifyPerHour'
  ) {
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
  | 'forbidden'
  | 'validation'
  | 'modelNotAllowed'
  | 'notFound'
  | 'network'
  | 'request'
  | 'unexpected';

/** Which message to show for a failed call. Branches on the stable code and status, never on the server's wording. */
export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.code === ERROR_CODES.FAQ_MODEL_NOT_ALLOWED) return 'modelNotAllowed';
  if (error.code === ERROR_CODES.VALIDATION_FAILED) return 'validation';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 422) return 'validation';
  return error.status >= 500 ? 'unexpected' : 'request';
}

/** The refetch interval for the overview: every 5 seconds while vectors wait, stopped at zero. */
export function pollInterval(data: FaqPlatformOverview | undefined): number | false {
  return data && data.stats.pending > 0 ? POLL_MS : false;
}

/** ready / (ready + pending) as a whole percent; null when there is nothing to index. */
export function progressPercent(stats: Pick<FaqPlatformOverview['stats'], 'ready' | 'pending'>) {
  const total = stats.ready + stats.pending;
  return total === 0 ? null : Math.floor((stats.ready / total) * 100);
}

/** answered / matches, or null when nothing was checked (no rate to show). */
export function answerRate(answered: number, matches: number): number | null {
  return matches > 0 ? answered / matches : null;
}

export interface RiskNotice {
  engineOff: boolean;
  modelChange: { from: string; to: string } | null;
}

/** What the operator must acknowledge before the change is sent. */
export function riskOf(saved: FaqPlatformConfig, body: UpdateFaqPlatformConfigInput): RiskNotice {
  return {
    engineOff: body.engineEnabled === false && saved.engineEnabled,
    modelChange:
      body.embeddingModel !== undefined && body.embeddingModel !== saved.embeddingModel
        ? { from: saved.embeddingModel, to: body.embeddingModel }
        : null,
  };
}
