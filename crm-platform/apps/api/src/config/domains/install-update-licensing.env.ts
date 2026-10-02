import { z } from 'zod';
import { SETUP_TOKEN_MIN_LENGTH } from '@crm/contracts';

/**
 * Environment of the install-update-licensing domain. Parsed here, once, at module construction: the shared
 * env.schema.ts is a kernel file this domain does not edit. Same contract as there: a malformed value stops the
 * process with a readable message rather than becoming a silently disabled guard.
 *
 * Compose files tend to pass an unset variable as an empty string, which must mean "not set".
 */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const instEnvSchema = z
  .object({
    /**
     * Deploy-time secret that opens first-run setup. Unset: setup is disabled (the operator CLI still works).
     * Set but short: refuse to start rather than run with a guessable gate.
     */
    SETUP_TOKEN: z.preprocess(
      blankToUndefined,
      z
        .string()
        .min(
          SETUP_TOKEN_MIN_LENGTH,
          `SETUP_TOKEN must be at least ${SETUP_TOKEN_MIN_LENGTH} characters`,
        )
        .optional(),
    ),
    /** Public live demo: every write is refused unless allow-listed (demo-policy.ts). */
    DEMO_MODE: z.preprocess(blankToUndefined, booleanish.default(false)),
    /** Injected by the image build; shown on the operator System page. */
    GIT_SHA: z.preprocess(blankToUndefined, z.string().max(64).optional()),
    BUILD_NUMBER: z.preprocess(blankToUndefined, z.string().max(32).optional()),
    BUILT_AT: z.preprocess(blankToUndefined, z.string().max(40).optional()),
    /** Override where the SQL migration files are read from (default: next to @crm/db). */
    MIGRATIONS_DIR: z.preprocess(blankToUndefined, z.string().optional()),
    /**
     * Purchase-code enforcement (WD-INST-003, -017, -020). `off` (default): this deployment is not a CodeCanyon copy
     * and the licence step is not part of setup or the Updater. `envato`: the code is checked against the Envato
     * author API with the two values below, supplied at deploy time and never shipped inside the image.
     */
    LICENCE_MODE: z.preprocess(blankToUndefined, z.enum(['off', 'envato']).default('off')),
    ENVATO_ITEM_ID: z.preprocess(blankToUndefined, z.string().max(32).optional()),
    ENVATO_AUTHOR_TOKEN: z.preprocess(blankToUndefined, z.string().max(256).optional()),
  })
  .superRefine((v, ctx) => {
    if (v.LICENCE_MODE !== 'envato') return;
    for (const key of ['ENVATO_ITEM_ID', 'ENVATO_AUTHOR_TOKEN'] as const) {
      if (v[key] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when LICENCE_MODE=envato`,
        });
      }
    }
  });

export type InstEnv = z.infer<typeof instEnvSchema>;

export function readInstEnv(raw: Record<string, unknown>): InstEnv {
  const parsed = instEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid install-update-licensing environment:\n${details}\n`);
  }
  return parsed.data;
}

/** Injection token for the parsed environment. */
export const INST_ENV = Symbol('INST_ENV');
