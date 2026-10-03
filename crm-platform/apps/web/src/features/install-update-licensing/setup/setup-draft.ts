import {
  ERROR_CODES,
  NODE_TOKEN_MIN_LENGTH,
  SETUP_TOKEN_MIN_LENGTH,
  evaluateSetupPassword,
  isValidLocale,
  isValidTimezone,
  setupAppSchema,
  type SetupPasswordRule,
  type SetupRunRequest,
} from '@crm/contracts';
import { suggestSlug } from '@/features/auth-registration-security/guest/slug';
import { ApiError } from '@/lib/api/errors';
import { LOCALES } from '@/i18n/locales';

/**
 * The install wizard's screens and form state (WD-INST-002, -005, -007, -008, -009). The same rules run on the server
 * in the call that writes; checking here only saves a round trip and names the problem next to the field.
 *
 * WaDesk's rail has seven entries and the licence page shares the first one with Welcome, so `railIndex` maps the
 * eight screens onto those seven.
 */
export const SCREENS = [
  'welcome',
  'licence',
  'requirements',
  'database',
  'application',
  'admin',
  'node',
  'install',
] as const;
export type Screen = (typeof SCREENS)[number];

/** The seven labelled steps of the rail, in order. */
export const RAIL = [
  'welcome',
  'requirements',
  'database',
  'application',
  'admin',
  'node',
  'install',
] as const;

/** 1-based position on the rail. The licence page sits under "Welcome", as in WaDesk. */
export function railIndex(screen: Screen): number {
  return screen === 'licence' ? 1 : RAIL.indexOf(screen) + 1;
}

export interface WizardDraft {
  setupToken: string;
  purchaseCode: string;
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  appName: string;
  appUrl: string;
  timezone: string;
  locale: string;
  fullName: string;
  email: string;
  password: string;
  confirm: string;
  workspaceName: string;
  nodeUrl: string;
  nodePort: string;
  nodeToken: string;
}

export const emptyDraft = (seed: { timezone?: string; origin?: string } = {}): WizardDraft => ({
  setupToken: '',
  purchaseCode: '',
  dbHost: '127.0.0.1',
  dbPort: '5432',
  dbName: '',
  dbUser: '',
  dbPassword: '',
  appName: '',
  appUrl: seed.origin ?? '',
  timezone: seed.timezone ?? 'UTC',
  locale: 'en',
  fullName: '',
  email: '',
  password: '',
  confirm: '',
  workspaceName: '',
  nodeUrl: 'http://localhost:8888',
  nodePort: '8888',
  nodeToken: '',
});

/** A message key under `install-update-licensing.setup.errors`, with the values its sentence needs. */
export interface Problem {
  key: string;
  params?: Record<string, string | number>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const passwordRules = (d: WizardDraft): SetupPasswordRule[] =>
  evaluateSetupPassword(d.password, { email: d.email, fullName: d.fullName });

const portProblem = (port: string): boolean => {
  const n = Number(port);
  return !Number.isInteger(n) || n < 1 || n > 65535;
};

/** The database form: all four text fields are required, the password may be blank (WaDesk allowed passwordless root). */
export function validateDatabase(d: WizardDraft): Problem[] {
  const out: Problem[] = [];
  if (!d.dbHost.trim()) out.push({ key: 'dbHost' });
  if (portProblem(d.dbPort)) out.push({ key: 'dbPort' });
  if (!d.dbName.trim()) out.push({ key: 'dbName' });
  if (!d.dbUser.trim()) out.push({ key: 'dbUser' });
  return out;
}

export function validateApplication(d: WizardDraft): Problem[] {
  const out: Problem[] = [];
  const name = d.appName.trim();
  if (!name) out.push({ key: 'appNameRequired' });
  else if (name.length > 100) out.push({ key: 'appNameLong', params: { max: 100 } });
  if (!setupAppSchema.shape.url.safeParse(d.appUrl).success) out.push({ key: 'appUrl' });
  if (!isValidTimezone(d.timezone)) out.push({ key: 'timezone' });
  if (!(LOCALES as readonly string[]).includes(d.locale) || !isValidLocale(d.locale)) {
    out.push({ key: 'locale' });
  }
  return out;
}

export function validateAdmin(d: WizardDraft): Problem[] {
  const out: Problem[] = [];
  if (!d.fullName.trim()) out.push({ key: 'fullNameRequired' });
  else if (d.fullName.trim().length > 120) out.push({ key: 'fullNameLong', params: { max: 120 } });
  if (!EMAIL.test(d.email.trim()) || d.email.trim().length > 191) out.push({ key: 'email' });
  for (const rule of passwordRules(d)) out.push({ key: `password.${rule}` });
  if (d.confirm !== d.password) out.push({ key: 'passwordMismatch' });
  const ws = d.workspaceName.trim();
  if (ws.length < 2) out.push({ key: 'workspaceRequired' });
  else if (ws.length > 120) out.push({ key: 'workspaceLong', params: { max: 120 } });
  return out;
}

export function validateNode(d: WizardDraft): Problem[] {
  const out: Problem[] = [];
  if (!setupAppSchema.shape.url.safeParse(d.nodeUrl).success) out.push({ key: 'nodeUrl' });
  if (portProblem(d.nodePort)) out.push({ key: 'nodePort' });
  if (d.nodeToken.length < NODE_TOKEN_MIN_LENGTH) {
    out.push({ key: 'nodeToken', params: { min: NODE_TOKEN_MIN_LENGTH } });
  }
  return out;
}

export const validateToken = (d: WizardDraft): Problem[] =>
  d.setupToken.trim().length < SETUP_TOKEN_MIN_LENGTH
    ? [{ key: 'tokenLength', params: { min: SETUP_TOKEN_MIN_LENGTH } }]
    : [];

/** The first screen whose fields have a problem, so the run screen can send the person back to it. */
export function firstInvalidScreen(d: WizardDraft): Screen | null {
  if (validateToken(d).length) return 'welcome';
  if (validateDatabase(d).length) return 'database';
  if (validateApplication(d).length) return 'application';
  if (validateAdmin(d).length) return 'admin';
  if (validateNode(d).length) return 'node';
  return null;
}

/**
 * The workspace has no address field in WaDesk (a random slug was made), so the address is derived from its name.
 * A name with no Latin letters or digits falls back to a fixed word rather than failing the install.
 */
export function workspaceSlug(name: string): string {
  return suggestSlug(name) || 'workspace';
}

export function toRunRequest(
  d: WizardDraft,
  step: number,
  licenceRequired: boolean,
): SetupRunRequest {
  return {
    step,
    setupToken: d.setupToken.trim(),
    ...(licenceRequired ? { purchaseCode: d.purchaseCode.trim() } : {}),
    app: { name: d.appName.trim(), url: d.appUrl.trim() },
    node: { serverUrl: d.nodeUrl.trim(), port: Number(d.nodePort), token: d.nodeToken },
    operator: {
      fullName: d.fullName.trim(),
      email: d.email.trim().toLowerCase(),
      password: d.password,
    },
    organization: {
      name: d.workspaceName.trim(),
      slug: workspaceSlug(d.workspaceName),
      timezone: d.timezone,
      locale: d.locale,
    },
  };
}

/** 32 random bytes as 64 hex characters: WaDesk's "Generate" button, from the same source (the browser's CSPRNG). */
export function generateNodeToken(
  random: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a),
): string {
  return Array.from(random(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** WaDesk's timezone typeahead: an empty search lists the first 25, otherwise the first 25 that contain the text. */
export function filterTimezones(all: readonly string[], query: string, limit = 25): string[] {
  const q = query.toLowerCase().trim();
  return (q ? all.filter((t) => t.toLowerCase().includes(q)) : all).slice(0, limit);
}

/** What the screens do about a failure. Branches on the problem `code`, never on message text. */
export type SetupFailure =
  | { kind: 'token' }
  | { kind: 'disabled' }
  | { kind: 'completed' }
  | { kind: 'prerequisites'; failed: string[] }
  | { kind: 'licence'; reason: string }
  | { kind: 'database'; reason: 'server' | 'unreachable'; message: string }
  | { kind: 'outOfOrder' }
  | { kind: 'step'; requestId?: string }
  | { kind: 'unknown'; requestId?: string };

export function classifyFailure(error: unknown): SetupFailure {
  if (!(error instanceof ApiError)) return { kind: 'unknown' };
  const first = error.fieldErrors[0];
  switch (error.code) {
    case ERROR_CODES.SETUP_TOKEN_INVALID:
      return { kind: 'token' };
    case ERROR_CODES.SETUP_DISABLED:
      return { kind: 'disabled' };
    case ERROR_CODES.SETUP_ALREADY_COMPLETED:
      return { kind: 'completed' };
    case ERROR_CODES.SETUP_PREREQUISITES_FAILED:
      return { kind: 'prerequisites', failed: error.fieldErrors.map((f) => f.path) };
    case ERROR_CODES.SETUP_LICENCE_INVALID:
      return { kind: 'licence', reason: first?.message ?? 'unknown' };
    case ERROR_CODES.SETUP_DATABASE_TEST_FAILED:
      return {
        kind: 'database',
        reason: first?.message === 'server' ? 'server' : 'unreachable',
        message: error.message,
      };
    case ERROR_CODES.SETUP_STEP_OUT_OF_ORDER:
      return { kind: 'outOfOrder' };
    case ERROR_CODES.SETUP_STEP_FAILED:
      return { kind: 'step', requestId: error.requestId };
    default:
      return { kind: 'unknown', requestId: error.requestId };
  }
}
