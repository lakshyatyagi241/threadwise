import { z } from 'zod';
import { checkProviderBaseUrl } from '../whatsapp-providers/base-url';
import { connectorTypeSchema, marketSlugSchema } from './enums';
import { marketLinkSchema, type MarketProblem } from './manifest';

/**
 * A connector recipe (M-05, spec 6.3): an integration described as data, not code. A recipe names a connector type (one of the five
 * mechanisms), the fields an admin must supply (sealed, write-only), where to send requests or what to parse, how the portal's field
 * names map onto lead and contact fields, how often to poll, the rate limits to respect, how portal errors map onto health, the setup
 * instructions shown to the admin, and test payloads for "send a sample lead".
 *
 * Adding a lead portal means writing and testing one of these (plus a small adapter only for an unusual portal).
 *
 * Every URL in a recipe is checked for shape here (https, a public DNS name, no credentials) and for where it points (every resolved
 * address public) by the API before it is stored and before every call, the same two-step guard the WhatsApp provider registry uses.
 */

export const RECIPE_SCHEMA_VERSION = 1;

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const scalarSchema = z.union([z.string().max(500), z.number(), z.boolean()]);
export const recipeFieldKeySchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,39}$/,
    'Use lowercase letters, digits and underscores, starting with a letter.',
  );

// --- paths and templates ---------------------------------------------------------------------------------------------------------

/** A path into a JSON payload: `lead.contact.phone`, `items[0].id`. No wildcards, no expressions. */
export const RECIPE_PATH_RE =
  /^[A-Za-z_][A-Za-z0-9_-]{0,39}(?:\.[A-Za-z0-9_-]{1,40}|\[\d{1,4}\]){0,10}$/;
export const recipePathSchema = z
  .string()
  .regex(RECIPE_PATH_RE, 'Use a path like lead.phone or items[0].id.');

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+(?:\.[A-Za-z0-9_]+)?)\s*\}\}/g;
/** The names a template may use: `cred.<authField>`, `config.<key>`, `cursor`, `since_iso`, `now_iso`. */
export function recipePlaceholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

// --- mapping ---------------------------------------------------------------------------------------------------------------------

export const RECIPE_TRANSFORMS = ['trim', 'lower', 'upper', 'digits', 'phone'] as const;

export const recipeSourceSchema = z.union([
  z.object({ from: recipePathSchema }).strict(),
  z.object({ const: scalarSchema }).strict(),
]);
export type RecipeSource = z.infer<typeof recipeSourceSchema>;

export const recipeFieldRuleSchema = z
  .object({
    /** The lead or contact field it fills: `name`, `phone`, `email`, `company`, `city`, `message`, or a custom field key. */
    to: recipeFieldKeySchema,
    from: recipePathSchema.optional(),
    const: scalarSchema.optional(),
    transform: z.array(z.enum(RECIPE_TRANSFORMS)).max(4).optional(),
    required: z.boolean().default(false),
    default: scalarSchema.nullable().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if ((r.from === undefined) === (r.const === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Give exactly one of from and const.' });
    }
  });
export type RecipeFieldRule = z.infer<typeof recipeFieldRuleSchema>;

export const recipeAttributionSchema = z
  .object({
    platform: recipeSourceSchema.optional(),
    campaign: recipeSourceSchema.optional(),
    adset: recipeSourceSchema.optional(),
    ad: recipeSourceSchema.optional(),
    form: recipeSourceSchema.optional(),
  })
  .strict();

export const recipeMappingSchema = z.discriminatedUnion('mode', [
  /** Generic: well-known names (name, phone, email, ...) are found by alias and every other scalar is carried over as it came. */
  z.object({ mode: z.literal('auto') }).strict(),
  z
    .object({
      mode: z.literal('explicit'),
      /** Where the sender's own id for the lead is. Without one, a hash of the delivery is the id (a repeat of the same delivery is still a duplicate). */
      externalId: z.object({ from: recipePathSchema }).strict().optional(),
      receivedAt: z.object({ from: recipePathSchema }).strict().optional(),
      /** When one delivery carries several leads, the path to the array. */
      itemsPath: recipePathSchema.optional(),
      fields: z.array(recipeFieldRuleSchema).min(1).max(40),
      attribution: recipeAttributionSchema.optional(),
      /** Prefix added to a bare 10 digit number by the `phone` transform. */
      defaultCountryCode: z
        .string()
        .regex(/^\d{1,3}$/)
        .default('91'),
    })
    .strict(),
]);
export type RecipeMapping = z.infer<typeof recipeMappingSchema>;

// --- auth fields -----------------------------------------------------------------------------------------------------------------

export const recipeAuthFieldSchema = z
  .object({
    key: z
      .string()
      .regex(
        /^[a-z][A-Za-z0-9_]{0,39}$/,
        'Use letters, digits and underscores, starting with a lowercase letter.',
      ),
    label: text(60),
    /** `secret`: sealed, write-only, shown as "set, ends in ####". `text`: kept in the clear and shown (an account id, a region). */
    kind: z.enum(['secret', 'text', 'select']),
    required: z.boolean().default(true),
    help: text(300).optional(),
    placeholder: text(80).optional(),
    options: z
      .array(z.object({ value: text(80), label: text(80) }).strict())
      .max(30)
      .optional(),
    /** A regular expression the value must match (checked on save). */
    pattern: text(200).optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.kind === 'select' && (!f.options || f.options.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'A select lists its options.' });
    }
    if (f.pattern) {
      try {
        new RegExp(f.pattern);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['pattern'],
          message: 'Not a valid regular expression.',
        });
      }
    }
  });
export type RecipeAuthField = z.infer<typeof recipeAuthFieldSchema>;

// --- connector configuration, per type ------------------------------------------------------------------------------------------

/** A public https host name, checked for shape (the address behind it is checked by the API). */
const hostUrlSchema = z.string().superRefine((raw, ctx) => {
  const v = checkProviderBaseUrl(raw);
  if (!v.ok) ctx.addIssue({ code: 'custom', message: v.reason });
});

export const webhookRelayConfigSchema = z
  .object({
    type: z.literal('webhook_relay'),
    /** `token`: the sender repeats the connection's secret in a header (Zapier, Make). `hmac`: the sender signs the body. `either`: both are accepted. */
    auth: z.enum(['token', 'hmac', 'either']).default('either'),
  })
  .strict();

export const pushConfigSchema = z
  .object({
    type: z.literal('push'),
    auth: z
      .object({
        scheme: z.enum(['header_token', 'hmac_sha256']),
        /** The header that carries the token or the signature. */
        header: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{1,59}$/),
        /** The auth field holding the secret the portal uses. Absent: the secret the platform generates for the connection. */
        credentialField: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const pullConfigSchema = z
  .object({
    type: z.literal('pull'),
    request: z
      .object({
        method: z.enum(['GET', 'POST']).default('GET'),
        baseUrl: hostUrlSchema,
        path: z
          .string()
          .regex(/^\/[^\s?#]{0,200}$/, 'Start with / and leave the query out.')
          .default('/'),
        query: z.record(z.string().max(60), z.string().max(300)).default({}),
        headers: z
          .record(z.string().regex(/^[A-Za-z][A-Za-z0-9-]{1,59}$/), z.string().max(300))
          .default({}),
        body: z.record(z.string().max(60), z.string().max(300)).optional(),
      })
      .strict(),
    response: z.object({ itemsPath: recipePathSchema.optional() }).strict().default({}),
    /** How a poll resumes: the value of this path of the newest item is sent as `{{cursor}}` next time. */
    cursor: z.object({ from: recipePathSchema }).strict().optional(),
    pollIntervalSeconds: z.number().int().min(60).max(86_400).default(300),
    /** Items fetched per poll at most, so one slow portal cannot hold the worker. */
    maxItemsPerPoll: z.number().int().min(1).max(500).default(100),
  })
  .strict();

export const oauthConfigSchema = z
  .object({
    type: z.literal('oauth'),
    authorizeUrl: hostUrlSchema,
    tokenUrl: hostUrlSchema,
    scopes: z.array(text(120)).max(30).default([]),
    pkce: z.boolean().default(true),
    /** The platform setting group that holds the OAuth client (id and sealed secret) for this provider, as the Google Calendar card does. */
    clientSettingKey: z.string().regex(/^[a-z][A-Za-z0-9_]{0,39}$/),
  })
  .strict();

const regexText = (max: number) =>
  text(max).refine((p) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  }, 'Not a valid regular expression.');

export const emailParseConfigSchema = z
  .object({
    type: z.literal('email_parse'),
    /** The alert emails come from these addresses or domains (`alerts@justdial.com`, `@99acres.com`). */
    senders: z.array(text(120)).min(1).max(10),
    subjectContains: text(120).optional(),
    rules: z
      .array(
        z
          .object({
            to: recipeFieldKeySchema,
            /** A regular expression run on the plain-text body; the first capture group is the value. */
            pattern: regexText(200),
            required: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export const recipeConnectorSchema = z.discriminatedUnion('type', [
  webhookRelayConfigSchema,
  pushConfigSchema,
  pullConfigSchema,
  oauthConfigSchema,
  emailParseConfigSchema,
]);
export type RecipeConnector = z.infer<typeof recipeConnectorSchema>;

// --- the recipe ------------------------------------------------------------------------------------------------------------------

export const recipeErrorMappingSchema = z
  .object({
    /** An exact HTTP status, or a range: give one of the two. */
    status: z.number().int().min(100).max(599).optional(),
    statusRange: z
      .tuple([z.number().int().min(100).max(599), z.number().int().min(100).max(599)])
      .optional(),
    bodyContains: text(100).optional(),
    code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    message: text(200),
    /** Whether the worker tries again later. */
    retry: z.boolean().default(false),
    /** What the connection's health becomes. */
    health: z.enum(['degraded', 'error', 'needs_reauth']).default('error'),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.status === undefined && e.statusRange === undefined && e.bodyContains === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Match on a status, a status range or a text in the answer.',
      });
    }
  });

export const recipeSchema = z
  .object({
    schemaVersion: z.literal(RECIPE_SCHEMA_VERSION),
    /** The app's slug (checked against the manifest). */
    key: marketSlugSchema,
    name: text(60, 2),
    /** The category slug (checked against the manifest). */
    category: marketSlugSchema,
    logo: marketLinkSchema.nullable().default(null),
    connector: recipeConnectorSchema,
    authFields: z.array(recipeAuthFieldSchema).max(10).default([]),
    mapping: recipeMappingSchema.default({ mode: 'auto' }),
    rateLimits: z
      .object({
        /** Deliveries accepted per minute from one connection; more is answered 429. */
        perMinute: z.number().int().min(1).max(6000).default(120),
        perDay: z.number().int().min(1).max(1_000_000).optional(),
      })
      .strict()
      .default({}),
    errorMapping: z.array(recipeErrorMappingSchema).max(20).default([]),
    setupInstructions: z
      .array(z.object({ title: text(80), body: text(1000) }).strict())
      .max(12)
      .default([]),
    testPayloads: z
      .array(
        z
          .object({
            name: text(60),
            payload: z
              .unknown()
              .refine(
                (p) => JSON.stringify(p ?? null).length <= 8192,
                'A test payload is at most 8 KB.',
              ),
          })
          .strict(),
      )
      .max(5)
      .default([]),
  })
  .strict()
  .superRefine((r, ctx) => {
    const keys = r.authFields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['authFields'],
        message: 'Two fields have the same key.',
      });
    }
    const known = new Set(keys);
    const checkTemplate = (value: string, path: Array<string | number>) => {
      for (const p of recipePlaceholdersOf(value)) {
        if (p.startsWith('cred.')) {
          if (!known.has(p.slice(5))) {
            ctx.addIssue({
              code: 'custom',
              path,
              message: `{{${p}}} names an auth field the recipe does not declare.`,
            });
          }
        } else if (!/^(config\.[A-Za-z0-9_]+|cursor|since_iso|now_iso)$/.test(p)) {
          ctx.addIssue({ code: 'custom', path, message: `{{${p}}} is not a known placeholder.` });
        }
      }
    };
    const c = r.connector;
    if (c.type === 'push' && c.auth.credentialField && !known.has(c.auth.credentialField)) {
      ctx.addIssue({
        code: 'custom',
        path: ['connector', 'auth', 'credentialField'],
        message: 'Names an auth field the recipe does not declare.',
      });
    }
    if (c.type === 'push' && c.auth.credentialField) {
      const f = r.authFields.find((x) => x.key === c.auth.credentialField);
      if (f && f.kind !== 'secret') {
        ctx.addIssue({
          code: 'custom',
          path: ['connector', 'auth', 'credentialField'],
          message: 'The field that carries the secret is a secret field.',
        });
      }
    }
    if (c.type === 'pull') {
      checkTemplate(c.request.path, ['connector', 'request', 'path']);
      for (const [k, v] of Object.entries(c.request.query))
        checkTemplate(v, ['connector', 'request', 'query', k]);
      for (const [k, v] of Object.entries(c.request.headers))
        checkTemplate(v, ['connector', 'request', 'headers', k]);
      for (const [k, v] of Object.entries(c.request.body ?? {}))
        checkTemplate(v, ['connector', 'request', 'body', k]);
      if (r.mapping.mode === 'auto') {
        // A portal answer has no generic shape worth guessing at: a pull recipe says where the fields are.
        ctx.addIssue({
          code: 'custom',
          path: ['mapping'],
          message: 'A pull recipe maps its fields explicitly.',
        });
      }
    }
    if (r.mapping.mode === 'explicit') {
      const targets = r.mapping.fields.map((f) => f.to);
      if (new Set(targets).size !== targets.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['mapping', 'fields'],
          message: 'Two rules fill the same field.',
        });
      }
    }
  });
export type MarketRecipe = z.infer<typeof recipeSchema>;
export type MarketRecipeInput = z.input<typeof recipeSchema>;

export function validateMarketRecipe(
  input: unknown,
): { ok: true; recipe: MarketRecipe } | { ok: false; problems: MarketProblem[] } {
  const r = recipeSchema.safeParse(input);
  if (r.success) return { ok: true, recipe: r.data };
  return {
    ok: false,
    problems: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

/** The part of a recipe a workspace admin needs to set an integration up: no endpoints, no mapping, no secrets. */
export const recipeSetupViewSchema = z.object({
  connectorType: connectorTypeSchema,
  authFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      kind: z.enum(['secret', 'text', 'select']),
      required: z.boolean(),
      help: z.string().nullable(),
      placeholder: z.string().nullable(),
      options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
    }),
  ),
  setupInstructions: z.array(z.object({ title: z.string(), body: z.string() })),
  hasTestPayload: z.boolean(),
});
export type RecipeSetupView = z.infer<typeof recipeSetupViewSchema>;
