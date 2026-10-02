import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Settings of the add-ons domain. Read straight from the environment (not the central schema, which belongs to the
 * kernel) and validated once; every value has a safe default so a fresh checkout runs.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  /** Where uploaded packages are unpacked and in-place modules are discovered (one folder per module slug). */
  ADDONS_DIR: z.string().default('addon'),
  /** The core version a package's `min_core` is compared with. */
  CORE_VERSION: z.string().default('0.1.0'),
  /** 100 MB, the Reference limit (TW-ADD-003). */
  ADDONS_MAX_PACKAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  /** Guards the unpacked size so a small ZIP cannot expand into the disk (Reference had no such limit). */
  ADDONS_MAX_UNPACKED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(400 * 1024 * 1024),
  ADDONS_MAX_ENTRIES: z.coerce.number().int().positive().default(5000),
  /** Installing needs a purchase code the server re-checks (the licence model itself belongs to INST). */
  ADDONS_REQUIRE_PURCHASE_CODE: booleanish.default(true),
  /** How long the registry answers from memory before re-reading (Reference: 300 s). */
  ADDONS_REGISTRY_TTL_MS: z.coerce.number().int().min(0).default(30_000),
  /**
   * Engine URLs on private, loopback or link-local addresses are refused (SSRF). Self-hosted installs whose engines
   * live on the same network turn this on.
   */
  ADDONS_ALLOW_PRIVATE_ENGINE_URLS: booleanish.default(false),
});

export type AddonsConfig = Omit<z.output<typeof schema>, 'ADDONS_DIR'> & { modulesDir: string };

/** Read at call time so tests can change the environment between runs. */
export function addonsConfig(env: NodeJS.ProcessEnv = process.env): AddonsConfig {
  const { ADDONS_DIR, ...rest } = schema.parse(env);
  return { ...rest, modulesDir: resolve(ADDONS_DIR) };
}
