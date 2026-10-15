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

/** `unescape` turns the two characters `\n` (and `\t`, `\r`, `\\`) that some portals leave in a message into the real character. */
export const RECIPE_TRANSFORMS = ['trim', 'lower', 'upper', 'digits', 'phone', 'unescape'] as const;

/** What the portal's wording means in ours: `{ "W": "Direct enquiry", "B": "Buy lead" }`. A value that is not listed is kept as it came. */
export const recipeValueMapSchema = z.record(z.string().max(60), z.string().max(120));

export const recipeSourceSchema = z.union([
  z.object({ from: recipePathSchema, map: recipeValueMapSchema.optional() }).strict(),
  z.object({ const: scalarSchema }).strict(),
]);
export type RecipeSource = z.infer<typeof recipeSourceSchema>;

export const recipeFieldRuleSchema = z
  .object({
    /** The lead or contact field it fills: `name`, `phone`, `email`, `company`, `city`, `message`, or a custom field key. */
    to: recipeFieldKeySchema,
    from: recipePathSchema.optional(),
    /** Paths tried in order when `from` is absent or empty (IndiaMART sends a second mobile and a landline when the first is missing). */
    fallbackFrom: z.array(recipePathSchema).max(4).optional(),
    const: scalarSchema.optional(),
    transform: z.array(z.enum(RECIPE_TRANSFORMS)).max(4).optional(),
    /** Values the portal sends for "nothing" (`IndiaMART Buyer` for an unknown name): read as absent, compared ignoring case. */
    ignore: z.array(z.string().max(80)).max(10).optional(),
    /** Applied last: the portal's wording to ours. */
    map: recipeValueMapSchema.optional(),
    required: z.boolean().default(false),
    default: scalarSchema.nullable().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if ((r.from === undefined) === (r.const === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Give exactly one of from and const.' });
    }
    if (r.fallbackFrom && r.from === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['fallbackFrom'],
        message: 'fallbackFrom goes with from.',
      });
    }
  });
export type RecipeFieldRule = z.infer<typeof recipeFieldRuleSchema>;

/**
 * Where the time a portal says a lead arrived is, and how it is written. `iso`: ISO 8601, or `2024-04-10 11:17:14` (a time with no zone
 * is read in the portal's own zone, `utcOffsetMinutes` east of UTC: IST is 330). `epoch_seconds` and `epoch_millis` are unambiguous.
 */
export const recipeTimeSchema = z
  .object({
    from: recipePathSchema,
    format: z.enum(['iso', 'epoch_seconds', 'epoch_millis']).default('iso'),
    utcOffsetMinutes: z.number().int().min(-720).max(840).default(0),
  })
  .strict();
export type RecipeTime = z.infer<typeof recipeTimeSchema>;

/**
 * A lead id for a portal that gives none (Housing.com): a hash of the values that identify a lead, so the same lead fetched twice (window
 * overlap, a retry, push and pull both delivering it) is one lead. Parts are read after their transforms (`phone` makes `98765 43210` and
 * `+919876543210` the same); when any part is missing the hash of the whole item is the id, which still recognises an identical repeat.
 */
export const recipeDerivedIdSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            from: recipePathSchema,
            transform: z.array(z.enum(RECIPE_TRANSFORMS)).max(4).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    prefix: z
      .string()
      .regex(/^[a-z0-9]{1,8}$/)
      .default('d'),
  })
  .strict();
export type RecipeDerivedId = z.infer<typeof recipeDerivedIdSchema>;

export const recipeAttributionSchema = z
  .object({
    platform: recipeSourceSchema.optional(),
    campaign: recipeSourceSchema.optional(),
    adset: recipeSourceSchema.optional(),
    ad: recipeSourceSchema.optional(),
    form: recipeSourceSchema.optional(),
  })
  .strict();

/**
 * Proof of consent a portal or an ad platform sends with a lead (BL-168, privacy spec 4.3.2). OPTIONAL: a recipe without it never grants
 * anything. `given` is where the portal says the person agreed (a yes or true, read with the same yes/no words the contact import
 * reads); the rest is the evidence kept with the grant: the wording shown, its version, when they agreed, and the provider's form and ad
 * ids. A lead whose `given` is not a yes carries no consent, whatever else is mapped.
 */
export const recipeConsentSchema = z
  .object({
    given: recipeSourceSchema,
    text: recipeSourceSchema.optional(),
    version: recipeSourceSchema.optional(),
    at: recipeTimeSchema.optional(),
    formId: recipeSourceSchema.optional(),
    adId: recipeSourceSchema.optional(),
    /** The channels the wording covers. Omitted: a phone is WhatsApp, an address is email (SMS only when named here). */
    channels: z
      .array(z.enum(['whatsapp', 'sms', 'email']))
      .min(1)
      .max(3)
      .optional(),
  })
  .strict();
export type RecipeConsent = z.infer<typeof recipeConsentSchema>;

export const recipeMappingSchema = z.discriminatedUnion('mode', [
  /**
   * Generic: well-known names (name, phone, email, ...) are found by alias and every other scalar is carried over as it came. A portal
   * whose payload is only PROPOSED (nobody has seen a real one) uses this until a sample shows the real names, and still labels its leads.
   */
  z
    .object({
      mode: z.literal('auto'),
      /** The attribution platform when the payload names none (`justdial`). */
      platform: z.string().trim().min(1).max(60).optional(),
      /** Prefix added to a bare 10 digit number. */
      defaultCountryCode: z
        .string()
        .regex(/^\d{1,3}$/)
        .default('91'),
      /** A hash of these values is the lead id when the payload carries none. */
      externalIdDerive: recipeDerivedIdSchema.optional(),
      /** The portal sends no time: the lead is stamped with the time it was received, and says so (`received_at_approximate`). */
      receivedAtApproximate: z.boolean().default(false),
      /** A time the payload does send, written with no zone, is the portal's own: minutes east of UTC (IST is 330). */
      utcOffsetMinutes: z.number().int().min(-720).max(840).default(0),
    })
    .strict(),
  z
    .object({
      mode: z.literal('explicit'),
      /** Where the sender's own id for the lead is. Without one, a hash of the delivery is the id (a repeat of the same delivery is still a duplicate). */
      externalId: z.object({ from: recipePathSchema }).strict().optional(),
      /** For a portal with no lead id: the values a hash is made of (see `recipeDerivedIdSchema`). */
      externalIdDerive: recipeDerivedIdSchema.optional(),
      receivedAt: recipeTimeSchema.optional(),
      /** The portal sends no time of its own: the lead carries `received_at_approximate`. */
      receivedAtApproximate: z.boolean().default(false),
      /** When one delivery carries several leads, the path to the array. */
      itemsPath: recipePathSchema.optional(),
      fields: z.array(recipeFieldRuleSchema).min(1).max(40),
      attribution: recipeAttributionSchema.optional(),
      /** Where the lead says the person agreed to be contacted, and the wording they saw. Optional; see `recipeConsentSchema`. */
      consent: recipeConsentSchema.optional(),
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

/**
 * How a connection's public address is read. The defaults are what the address always did (POST, JSON, acknowledged only after the lead
 * reached the pipeline), so a recipe that says nothing behaves as before.
 *
 * `methods`: a portal that cannot POST (JustDial delivers with GET) says so. `formats`: `json`, `form` (application/x-www-form-urlencoded,
 * nested keys like `lead[phone]` work), `xml` (an XML document: no DTD, no entities beyond the five predefined ones) and `query` (the
 * URL's query string: GET delivery). `mode` `async`: the delivery is stored whole, answered 200 at once and processed by the worker, for a
 * portal with a short timeout that turns the sender off after a day or two of failures (IndiaMART: 10 s, 48 h). `sync`: answered only
 * after the lead reached the pipeline (the generic webhook).
 */
export const RECIPE_INBOUND_METHODS = ['POST', 'GET'] as const;
export const RECIPE_INBOUND_FORMATS = ['json', 'form', 'xml', 'query'] as const;
export const inboundDeliverySchema = z
  .object({
    methods: z.array(z.enum(RECIPE_INBOUND_METHODS)).min(1).max(2).default(['POST']),
    formats: z.array(z.enum(RECIPE_INBOUND_FORMATS)).min(1).max(4).default(['json']),
    mode: z.enum(['sync', 'async']).default('sync'),
  })
  .strict()
  .default({});
export type InboundDelivery = z.infer<typeof inboundDeliverySchema>;

export const webhookRelayConfigSchema = z
  .object({
    type: z.literal('webhook_relay'),
    /**
     * `token`: the sender repeats the connection's secret in a header (Zapier, Make). `hmac`: the sender signs the body. `either`: both
     * are accepted. `path`: the secret is the second segment of the address (`.../hooks/<key>/<secret>`), for a sender that sets no header.
     */
    auth: z.enum(['token', 'hmac', 'either', 'path']).default('either'),
    delivery: inboundDeliverySchema,
  })
  .strict();

export const pushConfigSchema = z
  .object({
    type: z.literal('push'),
    auth: z
      .object({
        /**
         * `path_token`: the secret is the second segment of the address and no header is involved (IndiaMART allows an identifier in
         * the path; JustDial's backend team configures a URL and nothing else). The others carry it in `header`.
         */
        scheme: z.enum(['header_token', 'hmac_sha256', 'path_token']),
        /** The header that carries the token or the signature. Not used by `path_token`. */
        header: z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9-]{1,59}$/)
          .optional(),
        /** The auth field holding the secret the portal uses. Absent: the secret the platform generates for the connection. */
        credentialField: z.string().optional(),
      })
      .strict(),
    delivery: inboundDeliverySchema,
  })
  .strict();

const paramName = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/);

/**
 * Windows: a portal that answers "the leads between two times". The connection keeps a high-water mark (the end of the last window it
 * fetched); each poll asks from a little before it (`overlapSeconds`, so a lead the portal published late is not missed; the dedupe keys
 * absorb the repeats) until now, at most `maxSeconds` at a time. A connection that was paused or failing for longer than that catches up
 * one window per poll.
 *
 * `format` writes `{{window_start}}` and `{{window_end}}`: tokens `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`, `MON` (JAN to DEC) and the word
 * `epoch` (seconds), everything else as typed (`DD-MM-YYYYHH:mm:ss` is IndiaMART's own, with no space between date and time).
 */
export const pullWindowSchema = z
  .object({
    format: z.string().min(2).max(40),
    /** The portal's clock, minutes east of UTC (IST is 330). The window is written in it. */
    utcOffsetMinutes: z.number().int().min(-720).max(840).default(0),
    /** The longest span one request may cover: the portal's own limit (IndiaMART: 7 days). */
    maxSeconds: z
      .number()
      .int()
      .min(300)
      .max(31 * 86_400),
    /** Each window starts this long before where the last one ended. */
    overlapSeconds: z.number().int().min(0).max(86_400).default(0),
    /** The first poll of a new connection reaches back this far. */
    initialLookbackSeconds: z
      .number()
      .int()
      .min(60)
      .max(365 * 86_400)
      .default(86_400),
    /** No poll reaches back further than this (the portal's own history limit: IndiaMART 365 days). */
    maxLookbackSeconds: z
      .number()
      .int()
      .min(3600)
      .max(5 * 365 * 86_400)
      .optional(),
  })
  .strict();
export type PullWindow = z.infer<typeof pullWindowSchema>;

/** Paging inside one request window, for a portal that pages its answer. The poll stops at a short page or at `maxPages`. */
export const pullPaginationSchema = z
  .object({
    style: z.literal('page'),
    pageParam: paramName,
    sizeParam: paramName.optional(),
    pageSize: z.number().int().min(1).max(1000),
    startPage: z.number().int().min(0).max(1).default(1),
    maxPages: z.number().int().min(1).max(50).default(10),
  })
  .strict();

/**
 * A signed request (Housing.com): `signatureParam` carries HMAC-SHA256 (hex) of the request time, in whole epoch seconds as a decimal
 * string, keyed with the secret auth field `keyField`; `timestampParam` carries that time. The portal refuses a time too far from its
 * own clock, so the time is the moment of the call, never a stored value.
 */
export const pullSigningSchema = z
  .object({
    algorithm: z.literal('hmac_sha256'),
    keyField: z.string(),
    timestampParam: paramName,
    signatureParam: paramName,
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
        sign: pullSigningSchema.optional(),
      })
      .strict(),
    response: z
      .object({
        /** Where the list of leads is. Absent: the answer is the list, or an object holding exactly one list. */
        itemsPath: recipePathSchema.optional(),
        /**
         * Some portals answer HTTP 200 and put their own status in the body (IndiaMART: `CODE` 204, 401, 429). The number at this path is
         * then the status the recipe's error mapping and `emptyStatuses` see.
         */
        statusPath: recipePathSchema.optional(),
        /** Statuses that mean "no leads in this window": a success that hands nothing over. */
        emptyStatuses: z.array(z.number().int().min(100).max(599)).max(5).default([204]),
      })
      .strict()
      .default({}),
    /** How a poll resumes, for a portal that pages by id: the greatest value of this path is sent as `{{cursor}}` next time. Not with `window`. */
    cursor: z.object({ from: recipePathSchema }).strict().optional(),
    /** How a poll resumes, for a portal that answers a time range. Not with `cursor`. */
    window: pullWindowSchema.optional(),
    pagination: pullPaginationSchema.optional(),
    pollIntervalSeconds: z.number().int().min(60).max(86_400).default(300),
    /**
     * The portal's own limits, kept by the worker: no two requests for one connection closer than `minIntervalSeconds` (also what Sync
     * now waits for) and no more than `requestsPerMinute` (the pages of one poll are spaced by it).
     */
    limits: z
      .object({
        minIntervalSeconds: z.number().int().min(1).max(86_400).default(60),
        requestsPerMinute: z.number().int().min(1).max(600).default(30),
      })
      .strict()
      .default({}),
    /** Items taken from one answer at most, so one slow portal cannot hold the worker. A window that holds more is asked again in halves. */
    maxItemsPerPoll: z.number().int().min(1).max(5000).default(100),
    /**
     * The same recipe also receives deliveries (IndiaMART pushes in real time and is polled to fill the gaps): the connection has a public
     * address too, authenticated by a secret in its path and read by the same mapping. A lead that arrives by both doors is one lead.
     */
    push: z.object({ delivery: inboundDeliverySchema }).strict().optional(),
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

/**
 * A client: software the member installs elsewhere and signs in to with their own account. Installing the listing records the workspace's
 * consent and unlocks the per-app permission key; each member then connects from the client itself. Nothing is received or issued here.
 */
export const clientConfigSchema = z
  .object({
    type: z.literal('client'),
    /** Where the member gets the client (a store page). Empty until the operator has the real address. */
    stores: z
      .array(z.object({ label: text(60), url: marketLinkSchema }).strict())
      .max(4)
      .default([]),
  })
  .strict();

export const recipeConnectorSchema = z.discriminatedUnion('type', [
  webhookRelayConfigSchema,
  pushConfigSchema,
  pullConfigSchema,
  oauthConfigSchema,
  emailParseConfigSchema,
  clientConfigSchema,
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
    /** The portal's stated penalty or wait (IndiaMART blocks a key for 15 minutes): the next poll is no sooner than this. */
    retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
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
        } else if (
          !/^(config\.[A-Za-z0-9_]+|cursor|since_iso|now_iso|now_epoch|window_start|window_end)$/.test(
            p,
          )
        ) {
          ctx.addIssue({ code: 'custom', path, message: `{{${p}}} is not a known placeholder.` });
        }
      }
    };
    const c = r.connector;
    if (c.type === 'push' && c.auth.scheme !== 'path_token' && c.auth.header === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['connector', 'auth', 'header'],
        message: 'Name the header that carries the token or the signature.',
      });
    }
    if (c.type === 'push' && c.auth.scheme === 'path_token' && c.auth.header !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['connector', 'auth', 'header'],
        message: 'A secret in the address uses no header.',
      });
    }
    if (c.type === 'push' || c.type === 'webhook_relay' || (c.type === 'pull' && c.push)) {
      const d = c.type === 'pull' ? c.push!.delivery : c.delivery;
      if (d.formats.includes('query') && !d.methods.includes('GET')) {
        ctx.addIssue({
          code: 'custom',
          path: ['connector', 'delivery', 'formats'],
          message: 'Reading the query string needs GET among the methods.',
        });
      }
      if (d.methods.includes('GET') && !d.formats.includes('query')) {
        ctx.addIssue({
          code: 'custom',
          path: ['connector', 'delivery', 'methods'],
          message: 'GET delivers in the query string: add query to the formats.',
        });
      }
    }
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
      if (c.cursor && c.window) {
        ctx.addIssue({
          code: 'custom',
          path: ['connector', 'window'],
          message: 'A poll resumes by a cursor or by a window, not both.',
        });
      }
      const used = new Set(
        [
          c.request.path,
          ...Object.values(c.request.query),
          ...Object.values(c.request.headers),
          ...Object.values(c.request.body ?? {}),
        ].flatMap((v) => recipePlaceholdersOf(v)),
      );
      if (!c.window && (used.has('window_start') || used.has('window_end'))) {
        ctx.addIssue({
          code: 'custom',
          path: ['connector', 'request'],
          message: '{{window_start}} and {{window_end}} need a window.',
        });
      }
      if (c.window && !(used.has('window_start') && used.has('window_end'))) {
        ctx.addIssue({
          code: 'custom',
          path: ['connector', 'window'],
          message: 'A window is used: send {{window_start}} and {{window_end}} in the request.',
        });
      }
      if (c.window) {
        if (c.window.overlapSeconds * 2 > c.window.maxSeconds) {
          ctx.addIssue({
            code: 'custom',
            path: ['connector', 'window', 'overlapSeconds'],
            message: 'The overlap is at most half of the longest window.',
          });
        }
        if (
          c.window.maxLookbackSeconds !== undefined &&
          c.window.initialLookbackSeconds > c.window.maxLookbackSeconds
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['connector', 'window', 'initialLookbackSeconds'],
            message: 'The first poll cannot reach back further than the portal keeps history.',
          });
        }
      }
      if (c.pollIntervalSeconds < c.limits.minIntervalSeconds) {
        ctx.addIssue({
          code: 'custom',
          path: ['connector', 'pollIntervalSeconds'],
          message: "The poll interval is not shorter than the portal's minimum interval.",
        });
      }
      if (c.request.sign) {
        const key = r.authFields.find((f) => f.key === c.request.sign!.keyField);
        if (!key || key.kind !== 'secret') {
          ctx.addIssue({
            code: 'custom',
            path: ['connector', 'request', 'sign', 'keyField'],
            message: 'The signing key is a secret auth field the recipe declares.',
          });
        }
        const { timestampParam, signatureParam } = c.request.sign;
        if (
          timestampParam === signatureParam ||
          [timestampParam, signatureParam].some((n) => n in c.request.query)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['connector', 'request', 'sign'],
            message: 'The signature parameters are not also set in the query.',
          });
        }
      }
      if (
        c.pagination &&
        [c.pagination.pageParam, c.pagination.sizeParam].some((n) => n && n in c.request.query)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['connector', 'pagination'],
          message: 'The paging parameters are not also set in the query.',
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
      if (r.mapping.externalId && r.mapping.externalIdDerive) {
        ctx.addIssue({
          code: 'custom',
          path: ['mapping', 'externalIdDerive'],
          message: "Give the portal's lead id or a derived one, not both.",
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
