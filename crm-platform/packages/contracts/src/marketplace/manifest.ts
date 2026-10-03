import { z } from 'zod';
import {
  connectorTypeSchema,
  marketAppKindSchema,
  marketSlugSchema,
  MARKET_SEMVER_RE,
} from './enums';
import { isMarketScope } from './scopes';

/**
 * The app manifest, version 1 (M-01, M-04). One document describes an app to the catalogue: who it is, what it may do (scopes), where it
 * shows up (surfaces), what it costs, who supports it, and for an integration which connector mechanism it uses. The manifest is DATA:
 * it never carries code that runs in the API process. (It is the successor of the extension manifest in `addons-extension-registry`:
 * the same idea, one declarative file, but per workspace and permissioned.)
 *
 * Surfaces are declared and stored in v1 and not yet rendered: they become live with third-party mini apps (phase 3).
 * The connector's recipe is a separate document (recipe.ts) stored beside the manifest on the version; the manifest only names the
 * connector type.
 */

export const MARKET_MANIFEST_VERSION = 1;

/** https, a host, no credentials, no whitespace. Display links only: nothing in the platform fetches these. */
const HTTPS_LINK_RE = /^https:\/\/[^\s/@?#]+(?::\d{1,5})?(?:[/?#]\S*)?$/;
export const marketLinkSchema = z
  .string()
  .trim()
  .max(500)
  .regex(HTTPS_LINK_RE, 'Use a full https:// address.');

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);

export const MARKET_SURFACE_TYPES = [
  'contact_panel',
  'deal_panel',
  'inbox_tab',
  'settings_page',
  'top_page',
  'automation_trigger',
  'automation_action',
  'list_action',
  'field_type',
  'dashboard_widget',
  'webhook_in',
  'webhook_out',
] as const;
export const marketSurfaceTypeSchema = z.enum(MARKET_SURFACE_TYPES);
export type MarketSurfaceType = z.infer<typeof marketSurfaceTypeSchema>;

export const marketSurfaceSchema = z
  .object({
    type: marketSurfaceTypeSchema,
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and underscores.'),
    label: text(60),
    /** Where an out-of-process app's iframe or webhook lives (phase 3). First-party surfaces are native and carry none. */
    url: marketLinkSchema.optional(),
  })
  .strict();
export type MarketSurface = z.infer<typeof marketSurfaceSchema>;

export const MARKET_PRICING_MODELS = ['free', 'included', 'addon'] as const;
export const marketPricingSchema = z
  .object({
    /** `free`: no charge. `included`: part of the plan (the plan feature on the listing decides who has it). `addon`: bought as a billing add-on. */
    model: z.enum(MARKET_PRICING_MODELS),
    note: text(200).optional(),
  })
  .strict();
export type MarketPricing = z.infer<typeof marketPricingSchema>;

export const marketSupportSchema = z
  .object({
    website: marketLinkSchema.optional(),
    email: z.string().trim().email().max(200).optional(),
    docs: marketLinkSchema.optional(),
    privacy: marketLinkSchema.optional(),
    terms: marketLinkSchema.optional(),
    status: marketLinkSchema.optional(),
  })
  .strict();
export type MarketSupport = z.infer<typeof marketSupportSchema>;

export const marketDeveloperSchema = z
  .object({ name: text(80), url: marketLinkSchema.optional() })
  .strict();
export type MarketDeveloper = z.infer<typeof marketDeveloperSchema>;

export const marketManifestSchema = z
  .object({
    manifestVersion: z.literal(MARKET_MANIFEST_VERSION),
    /** The app's slug: the stable machine id and the URL segment. */
    id: marketSlugSchema,
    name: text(60, 2),
    kind: marketAppKindSchema,
    /** A category slug of the same kind (checked against the catalogue when the version is saved). */
    category: marketSlugSchema,
    version: z.string().regex(MARKET_SEMVER_RE, 'Use MAJOR.MINOR.PATCH, for example 1.0.0.'),
    description: text(600, 10),
    scopes: z
      .array(z.string())
      .max(20)
      .default([])
      .superRefine((scopes, ctx) => {
        scopes.forEach((s, i) => {
          if (!isMarketScope(s)) {
            ctx.addIssue({ code: 'custom', path: [i], message: `Unknown scope "${s}".` });
          }
        });
        if (new Set(scopes).size !== scopes.length) {
          ctx.addIssue({ code: 'custom', message: 'A scope is listed twice.' });
        }
      }),
    surfaces: z.array(marketSurfaceSchema).max(20).default([]),
    pricing: marketPricingSchema.default({ model: 'free' }),
    support: marketSupportSchema.default({}),
    developer: marketDeveloperSchema.optional(),
    /** Integrations only: which of the five mechanisms they use. */
    connector: z.object({ type: connectorTypeSchema }).strict().optional(),
    /**
     * First-party mini apps only: the slug of the installable module in the module registry that provides the code. The app cannot be
     * installed while that module is switched off.
     */
    module: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.kind === 'integration' && !m.connector) {
      ctx.addIssue({
        code: 'custom',
        path: ['connector'],
        message: 'An integration names its connector type.',
      });
    }
    if (m.kind === 'mini_app' && m.connector) {
      ctx.addIssue({
        code: 'custom',
        path: ['connector'],
        message: 'Only an integration has a connector.',
      });
    }
    if (m.kind === 'integration' && m.module) {
      ctx.addIssue({
        code: 'custom',
        path: ['module'],
        message: 'Only a mini app is backed by a module.',
      });
    }
    const keys = new Set<string>();
    m.surfaces.forEach((s, i) => {
      const k = `${s.type}:${s.key}`;
      if (keys.has(k))
        ctx.addIssue({
          code: 'custom',
          path: ['surfaces', i, 'key'],
          message: 'Duplicate surface.',
        });
      keys.add(k);
    });
  });
export type MarketManifest = z.infer<typeof marketManifestSchema>;
export type MarketManifestInput = z.input<typeof marketManifestSchema>;

export type MarketProblem = { path: string; message: string };

/** Validates a manifest and returns every problem with its path, for the operator editor and for AppError details. */
export function validateMarketManifest(
  input: unknown,
): { ok: true; manifest: MarketManifest } | { ok: false; problems: MarketProblem[] } {
  const r = marketManifestSchema.safeParse(input);
  if (r.success) return { ok: true, manifest: r.data };
  return {
    ok: false,
    problems: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
