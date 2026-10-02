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

export const setupBootstrapRequestSchema = z
  .object({
    setupToken: setupTokenSchema,
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
  })
  .superRefine((v, ctx) => {
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
  });
export type SetupBootstrapRequest = z.infer<typeof setupBootstrapRequestSchema>;

export const setupBootstrapResponseSchema = z.object({
  completedAt: z.string().datetime(),
  organization: z.object({ id: uuidSchema, slug: z.string(), name: z.string() }),
  operator: z.object({ id: uuidSchema, email: z.string() }),
});
export type SetupBootstrapResponse = z.infer<typeof setupBootstrapResponseSchema>;
