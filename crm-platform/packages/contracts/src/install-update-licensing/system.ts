import { z } from 'zod';
import { setupPrerequisiteSchema } from './setup';

/**
 * Operator "System" page and readiness detail (WD-INST-004, -019, -025, -027): version and build, migration ledger,
 * dependency checks. Read-only; the browser-driven updater has no equivalent in a container deploy.
 */
export const releaseInfoSchema = z.object({
  version: z.string(),
  /** Short git sha injected at build; null when the image was built without it. */
  gitSha: z.string().nullable(),
  buildNumber: z.string().nullable(),
  builtAt: z.string().nullable(),
  environment: z.enum(['development', 'test', 'production']),
  /** DEMO_MODE guard is active (writes are refused unless allow-listed). */
  demoMode: z.boolean(),
});
export type ReleaseInfo = z.infer<typeof releaseInfoSchema>;

export const migrationRowSchema = z.object({
  id: z.string(),
  state: z.enum(['applied', 'pending', 'modified', 'missing-file']),
  appliedAt: z.string().datetime().nullable(),
});
export type MigrationRow = z.infer<typeof migrationRowSchema>;

export const systemCheckSchema = z.object({
  key: z.enum(['database', 'redis', 'migrations']),
  status: z.enum(['up', 'down', 'degraded']),
  latencyMs: z.number().int().nonnegative().optional(),
  detail: z.string().optional(),
});
export type SystemCheck = z.infer<typeof systemCheckSchema>;

export const systemStatusResponseSchema = z.object({
  release: releaseInfoSchema,
  uptimeSeconds: z.number().int().nonnegative(),
  setup: z.object({
    state: z.enum(['open', 'completed']),
    completedAt: z.string().datetime().nullable(),
    completedVersion: z.string().nullable(),
    prerequisites: z.array(setupPrerequisiteSchema),
  }),
  migrations: z.object({
    /** `unknown`: the migration files are not shipped with this build, so only the ledger can be reported. */
    status: z.enum(['current', 'pending', 'drift', 'unknown']),
    appliedCount: z.number().int().nonnegative(),
    rows: z.array(migrationRowSchema),
  }),
  checks: z.array(systemCheckSchema),
});
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;
