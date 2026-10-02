import { z } from 'zod';
import { emailSchema, uuidSchema } from '../common/ids';
import { orgSlugSchema } from '../auth-registration-security/login';

/**
 * First-run setup (TW-INST-001..015). The browser wizard becomes one status read, one token proof and one
 * bootstrap call that re-validates everything on the server: the wizard's flaw was a gate that existed only on the
 * pages, so every rule below is enforced by the request that creates the data.
 */

/** Deploy-time secret (env SETUP_TOKEN). 32+ characters so guessing it is not a plan. */
export const SETUP_TOKEN_MIN_LENGTH = 32;
export const setupTokenSchema = z.string().min(SETUP_TOKEN_MIN_LENGTH).max(256);

export const setupPrerequisiteKeys = ['database', 'migrations', 'permissions'] as const;
export const setupPrerequisiteSchema = z.object({
  key: z.enum(setupPrerequisiteKeys),
  ok: z.boolean(),
  /** Short machine-readable reason when not ok (e.g. `3 pending`). Never a stack or a connection string. */
  detail: z.string().optional(),
});
export type SetupPrerequisite = z.infer<typeof setupPrerequisiteSchema>;

export const setupStatusResponseSchema = z.object({
  /** `completed` also covers an environment that already has a platform operator. */
  state: z.enum(['open', 'completed']),
  completedAt: z.string().datetime().nullable(),
  /** false: SETUP_TOKEN is not configured, so setup is disabled (use `operator:create`). */
  tokenConfigured: z.boolean(),
  /** Empty once completed. */
  prerequisites: z.array(setupPrerequisiteSchema),
  /** The licence step is part of the wizard only when this deployment enforces a purchase code (LICENCE_MODE). */
  licenceRequired: z.boolean(),
  /** Highest install-run step that succeeded (0 to 6), so a reload can say how far the last attempt got. */
  runStep: z.number().int().min(0).max(6),
  /** Product version shown in the wizard footer. */
  version: z.string(),
});
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

export const verifySetupTokenRequestSchema = z.object({ setupToken: setupTokenSchema });
export type VerifySetupTokenRequest = z.infer<typeof verifySetupTokenRequestSchema>;
export const verifySetupTokenResponseSchema = z.object({ ok: z.literal(true) });

// --- password rule ----------------------------------------------------------------------------------------------

export const SETUP_PASSWORD_MIN_LENGTH = 12;

export type SetupPasswordRule = 'length' | 'upper' | 'lower' | 'number' | 'symbol' | 'personal';

/**
 * The platform owner is the highest-trust account, so the strict rule applies whatever any tenant policy says
 * (Reference accepted any password for the first admin and held it in plaintext in the session until finalize).
 * Pure so the browser can show the same hints the server enforces.
 */
export function evaluateSetupPassword(
  password: string,
  who: { email?: string; fullName?: string } = {},
): SetupPasswordRule[] {
  const broken: SetupPasswordRule[] = [];
  if (password.length < SETUP_PASSWORD_MIN_LENGTH) broken.push('length');
  if (!/[A-Z]/.test(password)) broken.push('upper');
  if (!/[a-z]/.test(password)) broken.push('lower');
  if (!/[0-9]/.test(password)) broken.push('number');
  if (!/[^A-Za-z0-9]/.test(password)) broken.push('symbol');
  const lower = password.toLowerCase();
  const personal = [who.email?.split('@')[0], ...(who.fullName?.split(/\s+/) ?? [])]
    .map((p) => p?.toLowerCase().trim())
    .filter((p): p is string => !!p && p.length >= 4);
  if (personal.some((p) => lower.includes(p))) broken.push('personal');
  return broken;
}

// --- bootstrap -----------------------------------------------------------------------------------------------------

/**
 * Asks the runtime's tz database rather than listing it: `Intl.supportedValuesOf('timeZone')` returns canonical names
 * only, so it rejects valid aliases such as Asia/Kolkata on some ICU builds.
 */
export function isValidTimezone(tz: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz) || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

/** TW-INST-007: application name and public URL. Both are checked here; Reference checked only that they were strings. */
export const setupAppSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z
    .string()
    .trim()
    .max(191)
    .url()
    .regex(/^https?:\/\//i, 'must be an http or https URL'),
});
export type SetupApp = z.infer<typeof setupAppSchema>;

/** TW-INST-009: where the Node bridge listens and the secret both sides share. */
export const NODE_TOKEN_MIN_LENGTH = 16;
export const setupNodeSchema = z.object({
  serverUrl: setupAppSchema.shape.url,
  port: z.number().int().min(1).max(65535),
  token: z.string().min(NODE_TOKEN_MIN_LENGTH).max(256),
});
export type SetupNode = z.infer<typeof setupNodeSchema>;

const setupBootstrapBase = z.object({
  setupToken: setupTokenSchema,
  /** Required by the wizard; the CLI/automation path may omit it and the deployment defaults apply. */
  app: setupAppSchema.optional(),
  node: setupNodeSchema.optional(),
  /** The Envato purchase code. Required only when the deployment enforces licences (status.licenceRequired). */
  purchaseCode: z.string().trim().max(120).optional(),
  operator: z.object({
    fullName: z.string().trim().min(1).max(120),
    email: emailSchema,
    password: z.string().min(1).max(256),
  }),
  organization: z.object({
    name: z.string().trim().min(2).max(120),
    /** Given, not random: the bootstrap is repeatable against the same workspace address (TW-INST-014 rule). */
    slug: orgSlugSchema,
    timezone: z.string().refine(isValidTimezone, 'unknown IANA timezone'),
    locale: z.string().max(35).refine(isValidLocale, 'not a valid language tag').default('en'),
  }),
});

type BootstrapBase = z.infer<typeof setupBootstrapBase>;
function checkOperatorPassword(v: BootstrapBase, ctx: z.RefinementCtx): void {
  const broken = evaluateSetupPassword(v.operator.password, {
    email: v.operator.email,
    fullName: v.operator.fullName,
  });
  for (const rule of broken) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['operator', 'password'],
      message: `password rule not met: ${rule}`,
    });
  }
}

export const setupBootstrapRequestSchema = setupBootstrapBase.superRefine(checkOperatorPassword);
export type SetupBootstrapRequest = z.infer<typeof setupBootstrapRequestSchema>;

export const setupBootstrapResponseSchema = z.object({
  completedAt: z.string().datetime(),
  organization: z.object({ id: uuidSchema, slug: z.string(), name: z.string() }),
  operator: z.object({ id: uuidSchema, email: z.string() }),
});
export type SetupBootstrapResponse = z.infer<typeof setupBootstrapResponseSchema>;

// --- the six-step install run (TW-INST-010) ----------------------------------------------------------------------

export const SETUP_RUN_STEPS = [
  'configuration',
  'migrations',
  'defaults',
  'account',
  'storage',
  'finalize',
] as const;
export type SetupRunStepName = (typeof SETUP_RUN_STEPS)[number];

/**
 * One call per row of the run screen. Every call carries the whole form, because the server keeps no draft (the
 * password in particular is never stored in a session): the steps are independent and idempotent, and the server
 * enforces their order from `platform_setup.run_step`, not from the page.
 */
export const setupRunRequestSchema = setupBootstrapBase
  .extend({ step: z.number().int().min(1).max(SETUP_RUN_STEPS.length) })
  .superRefine(checkOperatorPassword);
export type SetupRunRequest = z.infer<typeof setupRunRequestSchema>;

export const setupRunResponseSchema = z.object({
  step: z.number().int().min(1).max(SETUP_RUN_STEPS.length),
  ok: z.literal(true),
  /** Set by the last step only. */
  result: setupBootstrapResponseSchema.optional(),
});
export type SetupRunResponse = z.infer<typeof setupRunResponseSchema>;

// --- requirements (TW-INST-004) --------------------------------------------------------------------------------

const requirementTileSchema = z.object({ key: z.string(), ok: z.boolean() });

/** The pre-flight screen: the same panels as Reference's, with this stack's checks. */
export const setupRequirementsResponseSchema = z.object({
  runtime: z.object({ version: z.string(), required: z.string(), ok: z.boolean() }),
  /** Reference's "PHP extensions": the native modules this API cannot run without. */
  modules: z.array(requirementTileSchema),
  /** What the install talks to: database, Redis, migrations, seeded permission definitions. */
  services: z.array(requirementTileSchema),
  /** Reference's "Directories": the places the API writes. */
  directories: z.array(requirementTileSchema),
  /** Reference's "PDO drivers": the database engine and its extensions. */
  database: z.object({
    engine: z.string().nullable(),
    version: z.string().nullable(),
    extensions: z.array(z.string()),
    ok: z.boolean(),
  }),
  allPassed: z.boolean(),
});
export type SetupRequirementsResponse = z.infer<typeof setupRequirementsResponseSchema>;

// --- database step (TW-INST-005, -006) --------------------------------------------------------------------------

export const setupDatabaseTestRequestSchema = z.object({
  setupToken: setupTokenSchema,
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(63),
  username: z.string().trim().min(1).max(63),
  /** Optional like Reference's; blank means "the password this deployment already uses" when the rest matches it. */
  password: z.string().max(256).optional(),
});
export type SetupDatabaseTestRequest = z.infer<typeof setupDatabaseTestRequestSchema>;

/** What the database form starts with: the deployment's own connection, never its password. */
export const setupDatabaseDefaultsResponseSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  database: z.string(),
  username: z.string(),
});
export type SetupDatabaseDefaults = z.infer<typeof setupDatabaseDefaultsResponseSchema>;

export const setupDatabaseTestResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});
export type SetupDatabaseTestResponse = z.infer<typeof setupDatabaseTestResponseSchema>;

// --- licence (TW-INST-003, -017, -020) -------------------------------------------------------------------------

export const licenceVerifyRequestSchema = z.object({
  setupToken: setupTokenSchema,
  purchaseCode: z.string().trim().min(1).max(120),
});
export type LicenceVerifyRequest = z.infer<typeof licenceVerifyRequestSchema>;
