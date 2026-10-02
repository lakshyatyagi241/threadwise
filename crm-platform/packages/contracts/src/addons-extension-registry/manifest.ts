import { z } from 'zod';

/**
 * The extension manifest (WD-ADD-004): the one contract every module follows, whether it arrives as a ZIP or is
 * dropped into the modules folder by hand. A manifest declares contributions as DATA (navigation, plan flags, plan
 * limits); it never carries code that runs inside the API process.
 *
 * The file format (`extension.json`) is snake_case because it is hand-written; everything normalised from it, which
 * is what the registry stores and the API returns, is camelCase.
 *
 * Lenient where WaDesk was (a bad nav item or a blank flag key is skipped, not fatal), strict where WaDesk was
 * dangerous (the slug becomes a folder name, so it is validated: WD-ADD-004 rule 3).
 */

export const MANIFEST_SCHEMA_VERSION = 1;

/** Machine key and folder name; the extensions table stores it in a 64-character column. */
export const EXTENSION_SLUG_RE = /^[a-z0-9_-]{1,64}$/;
export const extensionSlugSchema = z
  .string()
  .regex(EXTENSION_SLUG_RE, 'Use 1 to 64 lowercase letters, digits, - or _.');

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ICON_RE = /^[a-z0-9-]{1,32}$/;

/** A path that can only point at this app: scheme and host are dropped, so a manifest cannot link off-site. */
export function toLocalPath(href: string): string | null {
  const trimmed = href.trim().replace(/\\/g, '/');
  if (!trimmed) return null;
  const noScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:/i, '').replace(/^\/\/[^/?#]*/, '');
  const path = `/${noScheme.replace(/^\/+/, '')}`;
  return path.split(/[?#]/)[0]!.split('/').includes('..') ? null : path;
}

const str = (max: number) => z.string().trim().max(max);

export interface NavContribution {
  key: string;
  href: string;
  label: string;
  /** A short icon name the console maps to its own icon set; raw markup from a package is never rendered. */
  icon: string | null;
  after: string;
}

export interface PlanFeatureContribution {
  key: string;
  label: string;
  group: string;
}

export interface PlanLimitContribution {
  key: string;
  label: string;
  group: string;
  /** null = unlimited, which is not the same as 0. */
  default: number | null;
  hint: string;
}

const humanise = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function normaliseNav(raw: unknown): NavContribution[] {
  if (!Array.isArray(raw)) return [];
  const out: NavContribution[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    const href = typeof r.href === 'string' ? toLocalPath(r.href) : null;
    if (!KEY_RE.test(key.replace(/-/g, '_')) || !href) continue; // missing key or href: dropped silently
    out.push({
      key,
      href,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 80) : key,
      icon: typeof r.icon === 'string' && ICON_RE.test(r.icon) ? r.icon : null,
      after: typeof r.after === 'string' ? r.after.slice(0, 64) : '',
    });
  }
  return out;
}

/** `plan_features` / `plan_limits` accept a plain list of keys or a map key -> {label, group, ...}. */
function entries(raw: unknown): Array<[string, Record<string, unknown>]> {
  if (Array.isArray(raw)) {
    // a plain key, or an object with a `key` (the normalised form read back from the database)
    return raw.flatMap((k): Array<[string, Record<string, unknown>]> => {
      if (typeof k === 'string') return [[k, {}]];
      if (k && typeof k === 'object' && typeof (k as { key?: unknown }).key === 'string') {
        return [[(k as { key: string }).key, k as Record<string, unknown>]];
      }
      return [];
    });
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
      k,
      v && typeof v === 'object' ? (v as Record<string, unknown>) : {},
    ]);
  }
  return [];
}

const textOf = (v: unknown, fallback: string, max = 80) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback;

function normaliseFeatures(raw: unknown, groupFallback: string): PlanFeatureContribution[] {
  const seen = new Set<string>();
  const out: PlanFeatureContribution[] = [];
  for (const [key, meta] of entries(raw)) {
    if (!KEY_RE.test(key) || seen.has(key)) continue; // empty or malformed keys are skipped
    seen.add(key);
    out.push({
      key,
      label: textOf(meta.label, humanise(key)),
      group: textOf(meta.group, groupFallback),
    });
  }
  return out;
}

function normaliseLimits(raw: unknown, groupFallback: string): PlanLimitContribution[] {
  const seen = new Set<string>();
  const out: PlanLimitContribution[] = [];
  for (const [key, meta] of entries(raw)) {
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    const d = meta.default;
    out.push({
      key,
      label: textOf(meta.label, humanise(key)),
      group: textOf(meta.group, groupFallback),
      default: typeof d === 'number' && Number.isInteger(d) && d >= 0 ? d : null,
      hint: textOf(meta.hint, '', 200),
    });
  }
  return out;
}

/** Route entries are paths inside the package; nothing absolute, nothing that climbs out. */
function normaliseRoutes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim().replace(/\\/g, '/'))
    .filter((p) => p && !p.startsWith('/') && !p.split('/').includes('..') && p.length <= 200)
    .slice(0, 50);
}

/** What the file may contain. Everything but `slug` is optional (WD-ADD-004 data). */
export const extensionManifestFileSchema = z
  .object({
    schema_version: z
      .number()
      .int()
      .min(1)
      .max(MANIFEST_SCHEMA_VERSION)
      .default(MANIFEST_SCHEMA_VERSION),
    slug: extensionSlugSchema,
    name: str(128).optional(),
    version: str(32).optional(),
    min_core: str(32).optional(),
    nav: z
      .object({ admin: z.unknown().optional(), user: z.unknown().optional() })
      .partial()
      .optional(),
    plan_features: z.unknown().optional(),
    plan_limits: z.unknown().optional(),
    routes: z.unknown().optional(),
    migrate: z.boolean().optional(),
  })
  .passthrough()
  .transform((m) => {
    const name = m.name || m.slug;
    return {
      schemaVersion: m.schema_version,
      slug: m.slug,
      name,
      version: m.version || '1.0.0',
      minCore: m.min_core ?? '',
      nav: { admin: normaliseNav(m.nav?.admin), user: normaliseNav(m.nav?.user) },
      planFeatures: normaliseFeatures(m.plan_features, name),
      planLimits: normaliseLimits(m.plan_limits, name),
      routes: normaliseRoutes(m.routes),
      migrate: m.migrate ?? true,
    };
  });

/** The normalised manifest: the only shape stored in `extensions.manifest` and returned by the API. */
export type ExtensionManifest = z.output<typeof extensionManifestFileSchema>;

/** Parses the text of an extension.json. `null` when it is not JSON, not an object, or has no valid slug. */
export function parseManifestText(text: string): ExtensionManifest | null {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  const parsed = extensionManifestFileSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Re-validates a manifest read back from the database (written by us, but the column is jsonb). */
export function readStoredManifest(raw: unknown): ExtensionManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const asFile = {
    schema_version: m.schemaVersion,
    slug: m.slug,
    name: m.name,
    version: m.version,
    min_core: m.minCore,
    nav: m.nav,
    plan_features: m.planFeatures,
    plan_limits: m.planLimits,
    routes: m.routes,
    migrate: m.migrate,
  };
  const parsed = extensionManifestFileSchema.safeParse(asFile);
  return parsed.success ? parsed.data : null;
}
