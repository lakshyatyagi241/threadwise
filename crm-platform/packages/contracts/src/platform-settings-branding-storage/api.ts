import { z } from 'zod';
import { SET_GROUP_SCHEMAS, SET_SECRET_FIELDS, setGroupSchema, type SetGroup } from './groups';

/** GET /v2/platform/settings/groups/:group */
export const setGroupResponseSchema = z.object({
  group: setGroupSchema,
  /** Non-secret fields, every one present (defaults fill what was never saved). */
  values: z.record(z.unknown()),
  /** One entry per secret field of the group: whether a value is stored. The value is never returned. */
  secrets: z.record(z.object({ isSet: z.boolean() })),
  /** Send it back unchanged with the next PATCH. 0 = never saved. */
  rowVersion: z.number().int().min(0),
  updatedAt: z.string().datetime().nullable(),
  /** The last connection test of a testable group (mail, storage, realtime), if any. */
  test: z.object({ ok: z.boolean(), at: z.string().datetime() }).nullable(),
  /** Read-only facts that are not editable fields (the Team Inbox app's push state). Absent for most groups. */
  extra: z.record(z.unknown()).optional(),
});
export type SetGroupResponse = z.infer<typeof setGroupResponseSchema>;

/**
 * PATCH body for one group. `values` is a partial of the group's own schema (unknown fields are refused);
 * `secrets` maps a secret field to its new plaintext, `null` to remove it, and a blank string or an absent
 * key leaves the stored one alone (the form shows "saved, leave blank to keep").
 */
export function setPatchSchemaFor(group: SetGroup) {
  const secretKeys = SET_SECRET_FIELDS[group] as readonly string[];
  return z.object({
    rowVersion: z.number().int().min(0),
    values: (SET_GROUP_SCHEMAS[group] as z.AnyZodObject).partial().strict().default({}),
    secrets: z
      .record(z.string().max(4000).nullable())
      .default({})
      .refine((s) => Object.keys(s).every((k) => secretKeys.includes(k)), 'unknown secret field'),
  });
}
export type SetPatchRequest = {
  rowVersion: number;
  values: Record<string, unknown>;
  secrets: Record<string, string | null>;
};

export const setHubResponseSchema = z.object({
  kpis: z.object({
    savedGroups: z.number().int(),
    /** Saved groups that hold at least one non-empty value. */
    healthyGroups: z.number().int(),
    totalGroups: z.number().int(),
    /** Testable groups that are configured but have no successful test since they were last saved. */
    needsTest: z.array(setGroupSchema),
    secretFields: z.number().int(),
    lastUpdatedAt: z.string().datetime().nullable(),
  }),
  groups: z.array(
    z.object({
      group: setGroupSchema,
      saved: z.boolean(),
      updatedAt: z.string().datetime().nullable(),
      needsTest: z.boolean(),
    }),
  ),
});
export type SetHubResponse = z.infer<typeof setHubResponseSchema>;

export const setTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export type SetTestResult = z.infer<typeof setTestResultSchema>;

export const mailTestRequestSchema = z.object({ to: z.string().trim().email().max(200) });
export type MailTestRequest = z.infer<typeof mailTestRequestSchema>;

export const setExportResponseSchema = z.object({
  app: z.string(),
  exportedAt: z.string().datetime(),
  note: z.string(),
  settings: z.array(z.object({ key: z.string(), value: z.unknown(), secret: z.boolean() })),
});
export type SetExportResponse = z.infer<typeof setExportResponseSchema>;

/** GET /v2/public/site-config: the part of the settings every visitor needs (no secrets, no operator data). */
export const publicSiteConfigSchema = z.object({
  brand: z.object({
    name: z.string(),
    url: z.string(),
    faviconUrl: z.string(),
    logos: z.record(z.string()),
    fontFamily: z.string(),
    platformFooter: z.string(),
  }),
  defaults: z.object({
    timezone: z.string(),
    language: z.string(),
    currency: z.string(),
    countryCode: z.string(),
    countryIso: z.string(),
  }),
  maintenance: z.boolean(),
  /** `:root{--color-...}` for the overridden tokens, or an empty string when none differ. */
  themeCss: z.string(),
  seo: z.record(z.string()),
  footer: z.object({
    title: z.string(),
    copyright: z.string(),
    description: z.string(),
    social: z.record(z.string()),
  }),
  cookieBanner: z.object({
    enabled: z.boolean(),
    style: z.string(),
    message: z.string(),
    policyUrl: z.string(),
    termsUrl: z.string(),
    cookiesPolicyUrl: z.string(),
    respectDoNotTrack: z.boolean(),
  }),
  /** Tracker ids to load once the visitor consents; empty ids are omitted. */
  analytics: z.record(z.string()),
  customCode: z.object({ css: z.string(), js: z.string() }),
  /** Head tags of the installable app (WD-SET-036): shown only when `enabled`. */
  pwa: z.object({
    enabled: z.boolean(),
    themeColor: z.string(),
    shortName: z.string(),
    /** The 192 icon, else the favicon. */
    appleTouchIcon: z.string(),
  }),
  /** The separate Team Inbox app (WD-SET-038): its manifest is `/v2/public/team-inbox-manifest.webmanifest`. */
  teamInboxPwa: z.object({ enabled: z.boolean() }),
  /** Where the legal pages live: the saved URL, else the built-in `/legal/<page>` (WD-SET-030 rule 5). */
  legal: z.object({ terms: z.string(), privacy: z.string(), cookies: z.string() }),
  realtime: z.object({ enabled: z.boolean() }),
});
export type PublicSiteConfig = z.infer<typeof publicSiteConfigSchema>;
