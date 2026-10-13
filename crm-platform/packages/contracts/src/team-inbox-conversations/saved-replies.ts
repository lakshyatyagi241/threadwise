import { z } from 'zod';
import { channelKindSchema } from '../chat-conversations/channels';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import {
  MERGE_KEY_ALIASES,
  MERGE_TAG_PATTERN,
  normalizeMergeKey,
} from '../contacts-attributes-tags/attribute';

/**
 * Saved replies (TW-TIB1-024): the workspace's library of reusable replies an agent inserts into the composer. A reply is a shortcut
 * (`/thanks`), a title, a plain-text body that may carry `{{variables}}`, and an optional category. It is SHARED (everyone who may reply
 * sees it; only `inbox.savedreply.manage` writes it) or MINE (a personal reply only its owner sees, as in Reference).
 *
 * The body is plain text with WhatsApp's own markup (`*bold*`, `_italic_`): it is never HTML, never rendered as HTML.
 * Variables are filled in on the server from the open conversation (`POST .../use`); the picker never sends anything by itself.
 * See docs/api/saved-replies.md and docs/threadwise-port/wiring/saved-replies.md.
 */

export const SAVED_REPLY_SHORTCUT_MAX = 64;
export const SAVED_REPLY_TITLE_MAX = 128;
export const SAVED_REPLY_BODY_MAX = 4000;
export const SAVED_REPLY_CATEGORY_MAX = 64;
export const SAVED_REPLY_LIST_MAX = 100;
export const SAVED_REPLY_CHANNEL_KINDS_MAX = 20;

// --- shortcut ---------------------------------------------------------------------------------------------------------------------

/**
 * The stored form of a shortcut: what Reference's `Str::slug(shortcut, '_')` made of it ("Thank You" becomes `thank_you`), extended to
 * every script (an Arabic shortcut stays Arabic). Compatibility-normalised, lower case, a leading `/` dropped, runs of spaces, hyphens
 * and slashes become one underscore, everything but letters, digits and underscores is removed, then trimmed of underscores and cut to
 * the maximum length. An empty result means the input held nothing a shortcut can be made of.
 */
export function normalizeShortcut(raw: string): string {
  const cleaned = raw
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\s\-/]+/g, '_')
    .replace(/[^\p{L}\p{N}\p{M}_]/gu, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return Array.from(cleaned).slice(0, SAVED_REPLY_SHORTCUT_MAX).join('').replace(/_+$/g, '');
}

// --- variables ----------------------------------------------------------------------------------------------------------------------

export const SAVED_REPLY_VARIABLE_GROUPS = [
  'contact',
  'agent',
  'workspace',
  'conversation',
] as const;
export type SavedReplyVariableGroup = (typeof SAVED_REPLY_VARIABLE_GROUPS)[number];

export interface SavedReplyVariable {
  /** The canonical name, written `{{key}}`. Dotted spellings (`contact.first_name`) and the contact aliases of the merge tags work too. */
  key: string;
  group: SavedReplyVariableGroup;
  /** What the live preview shows and the settings screen prints next to the chip. Never a real person. */
  sample: string;
}

/**
 * The variables the picker fills in. The contact ones are the merge tags every other part of the product resolves (templates,
 * broadcasts, campaigns; `crm/attributes/merge-tags.ts`); a contact's own custom attribute (`{{city}}`) works as well. Reference only
 * had `{{device_name}}` and `{{device_phone}}` (the number the conversation is pinned to); they keep working.
 */
export const SAVED_REPLY_VARIABLES: readonly SavedReplyVariable[] = [
  { key: 'first_name', group: 'contact', sample: 'Amira' },
  { key: 'last_name', group: 'contact', sample: 'Khan' },
  { key: 'name', group: 'contact', sample: 'Amira Khan' },
  { key: 'email', group: 'contact', sample: 'amira@example.com' },
  { key: 'phone', group: 'contact', sample: '971500000000' },
  { key: 'agent_name', group: 'agent', sample: 'Sam Rivera' },
  { key: 'agent_first_name', group: 'agent', sample: 'Sam' },
  { key: 'workspace_name', group: 'workspace', sample: 'Acme Support' },
  { key: 'company_name', group: 'workspace', sample: 'Acme Support' },
  { key: 'today', group: 'workspace', sample: '2026-01-15' },
  { key: 'device_name', group: 'conversation', sample: 'Sales line' },
  { key: 'device_phone', group: 'conversation', sample: '+971 4 000 0000' },
];

const KNOWN_VARIABLE_KEYS: ReadonlySet<string> = new Set(SAVED_REPLY_VARIABLES.map((v) => v.key));
/** Contact columns the shared merge-tag resolver also knows, beyond the catalogue's short list. */
const CONTACT_EXTRA_KEYS: ReadonlySet<string> = new Set([
  'middle_name',
  'title',
  'mobile',
  'country_code',
  'address',
  'language',
  'groups',
  'contact_group',
  'business_name',
]);

/**
 * `{{ Contact.First Name }}` to the key it means (`first_name`): the merge-tag normalisation (case, spaces, dots), a `contact` prefix
 * dropped, then the contact aliases (`full_name` is `name`). `agent.name` is `agent_name`, `workspace.name` is `workspace_name`.
 */
export function canonicalVariableKey(raw: string): string {
  const key = normalizeMergeKey(raw);
  const bare = key.startsWith('contact_') && key.length > 8 ? key.slice(8) : key;
  return MERGE_KEY_ALIASES[bare] ?? bare;
}

/** Whether a canonical key is one the product itself defines (the catalogue and the contact columns). Anything else is a custom attribute or a typo. */
export const isBuiltInVariable = (key: string): boolean =>
  KNOWN_VARIABLE_KEYS.has(key) || CONTACT_EXTRA_KEYS.has(key);

export const SAVED_REPLY_ISSUE_REASONS = ['unknown', 'empty'] as const;
export type SavedReplyIssueReason = (typeof SAVED_REPLY_ISSUE_REASONS)[number];

export interface SavedReplyIssue {
  /** The variable as written, braces included. */
  token: string;
  key: string;
  /** `unknown`: no such variable. `empty`: a real variable with no value for this contact or conversation. */
  reason: SavedReplyIssueReason;
}

/**
 * The value of a canonical variable key: a string (may be empty) when the variable exists, `undefined` when it does not.
 * An empty string or `null` means "exists, nothing to put there".
 */
export type VariableLookup = (key: string) => string | null | undefined;

/**
 * Fills `{{variables}}` in a reply. A variable with a value is replaced; one without (unknown, or known but empty for this contact)
 * stays exactly as written and is listed in `issues`, so the agent sees the braces in the composer and fixes them before sending.
 * Nothing is dropped silently and nothing is ever sent by this function. Pure: the server and the settings preview run the same code.
 */
export function renderSavedReply(
  template: string,
  lookup: VariableLookup,
): { text: string; issues: SavedReplyIssue[] } {
  const issues: SavedReplyIssue[] = [];
  const text = template.replace(MERGE_TAG_PATTERN, (match, inner: string) => {
    const key = canonicalVariableKey(inner);
    const value = key === '' ? undefined : lookup(key);
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (!issues.some((i) => i.token === match)) {
      issues.push({ token: match, key, reason: value === undefined ? 'unknown' : 'empty' });
    }
    return match;
  });
  return { text, issues };
}

/** The distinct variables a body uses, in order of first use, as the canonical keys. */
export function variablesIn(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(MERGE_TAG_PATTERN)) {
    const key = canonicalVariableKey(m[1] ?? '');
    if (key) seen.add(key);
  }
  return [...seen];
}

/** A lookup over the catalogue's sample values: the settings screen's live preview. Custom attributes are not known there. */
export const sampleVariableLookup: VariableLookup = (key) =>
  SAVED_REPLY_VARIABLES.find((v) => v.key === key)?.sample ??
  (CONTACT_EXTRA_KEYS.has(key) ? '' : undefined);

// --- the resource ---------------------------------------------------------------------------------------------------------------

export const SAVED_REPLY_SCOPES = ['shared', 'mine'] as const;
export const savedReplyScopeSchema = z.enum(SAVED_REPLY_SCOPES);
export type SavedReplyScope = z.infer<typeof savedReplyScopeSchema>;

export const savedReplySchema = z.object({
  id: uuidSchema,
  /** Stored form, without the leading `/` (`thank_you`). */
  shortcut: z.string(),
  title: z.string(),
  body: z.string(),
  category: z.string().nullable(),
  /** Free text such as `en` or `ar`; informational, it never blocks an insert. */
  language: z.string().nullable(),
  /** Channel kinds the reply may be inserted on. Empty = every channel. */
  channelKinds: z.array(channelKindSchema),
  scope: savedReplyScopeSchema,
  usedCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().datetime().nullable(),
  /** Name of the member who created a shared reply (null once that member is gone). */
  createdByName: z.string().nullable(),
  /** Whether the caller may edit or delete it (a shared reply needs the manage right, a personal one is its owner's). */
  canEdit: z.boolean(),
  rowVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SavedReply = z.infer<typeof savedReplySchema>;

const noControlChars = (v: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);

const shortcutInput = z
  .string()
  .max(200)
  .transform(normalizeShortcut)
  .pipe(z.string().min(1, 'Use letters, numbers or underscores').max(SAVED_REPLY_SHORTCUT_MAX));
const titleInput = z.string().trim().min(1).max(SAVED_REPLY_TITLE_MAX);
const bodyInput = z
  .string()
  .trim()
  .min(1)
  .max(SAVED_REPLY_BODY_MAX)
  .refine(noControlChars, 'Control characters are not allowed');
const categoryInput = z
  .string()
  .trim()
  .max(SAVED_REPLY_CATEGORY_MAX)
  .transform((v) => (v === '' ? null : v))
  .nullable();
const languageInput = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/, 'Use a language code such as en or pt-BR')
  .nullable();
const channelKindsInput = z
  .array(channelKindSchema)
  .max(SAVED_REPLY_CHANNEL_KINDS_MAX)
  .transform((v) => [...new Set(v)]);

/** `POST /inbox/saved-replies`. `scope: 'mine'` makes a personal reply (Reference's "Personal - only visible to me"); it cannot change later. */
export const createSavedReplySchema = z
  .object({
    shortcut: shortcutInput,
    title: titleInput,
    body: bodyInput,
    category: categoryInput.default(null),
    language: languageInput.default(null),
    channelKinds: channelKindsInput.default([]),
    scope: savedReplyScopeSchema.default('shared'),
  })
  .strict();
export type CreateSavedReplyInput = z.infer<typeof createSavedReplySchema>;

/** `PATCH /inbox/saved-replies/:id`: any subset with the `rowVersion` read. The scope is not editable (as in Reference). */
export const updateSavedReplySchema = z
  .object({
    rowVersion: z.number().int().positive(),
    shortcut: shortcutInput.optional(),
    title: titleInput.optional(),
    body: bodyInput.optional(),
    category: categoryInput.optional(),
    language: languageInput.optional(),
    channelKinds: channelKindsInput.optional(),
  })
  .strict();
export type UpdateSavedReplyInput = z.infer<typeof updateSavedReplySchema>;

/** `GET /inbox/saved-replies`: search (shortcut, title, body), tab, channel, category. Most used first. */
export const listSavedRepliesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  scope: z.enum(['all', 'shared', 'mine']).default('all'),
  /** Only replies that may be inserted on this channel kind (those restricted to others are left out). */
  channelKind: channelKindSchema.optional(),
  category: z.string().trim().min(1).max(SAVED_REPLY_CATEGORY_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(SAVED_REPLY_LIST_MAX).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListSavedRepliesQuery = z.infer<typeof listSavedRepliesQuerySchema>;

export const savedReplyListResponseSchema = z.object({
  data: z.array(savedReplySchema),
  page: pageInfoSchema,
  /** What the caller can see, ignoring the search and the tab. */
  counts: z.object({
    all: z.number().int().nonnegative(),
    shared: z.number().int().nonnegative(),
    mine: z.number().int().nonnegative(),
  }),
  /** Distinct categories among the replies the caller can see, for the filter. */
  categories: z.array(z.string()),
  /** Every reply of the workspace, personal ones included (what the plan counts). */
  total: z.number().int().nonnegative(),
  /** The plan's cap; null = unlimited. */
  limit: z.number().int().positive().nullable(),
});
export type SavedReplyListResponse = z.infer<typeof savedReplyListResponseSchema>;

/** `POST /inbox/saved-replies/:id/use`: render the reply for this conversation and count the use. */
export const useSavedReplySchema = z.object({ conversationId: uuidSchema }).strict();
export type UseSavedReplyInput = z.infer<typeof useSavedReplySchema>;

export const savedReplyIssueSchema = z.object({
  token: z.string(),
  key: z.string(),
  reason: z.enum(SAVED_REPLY_ISSUE_REASONS),
});

export const useSavedReplyResponseSchema = z.object({
  id: uuidSchema,
  /** The body with its variables filled in. A variable that could not be filled is left as written (see `issues`). */
  text: z.string(),
  issues: z.array(savedReplyIssueSchema),
  usedCount: z.number().int().nonnegative(),
});
export type UseSavedReplyResponse = z.infer<typeof useSavedReplyResponseSchema>;

// --- import and export (CSV) ------------------------------------------------------------------------------------------------------

/** The CSV columns of the export, in this order. The import finds them by header name (any order, any case). */
export const SAVED_REPLY_CSV_COLUMNS = [
  'title',
  'shortcut',
  'body',
  'category',
  'language',
  'channel',
] as const;
export const SAVED_REPLY_IMPORT_MAX_ROWS = 1000;
export const SAVED_REPLY_IMPORT_MAX_BYTES = 1024 * 1024;
/** Rows listed back per import (the rest are only counted). */
export const SAVED_REPLY_IMPORT_ROWS_SHOWN = 200;

export const SAVED_REPLY_DUPLICATE_POLICIES = ['skip', 'overwrite'] as const;
export const savedReplyDuplicatePolicySchema = z.enum(SAVED_REPLY_DUPLICATE_POLICIES);
export type SavedReplyDuplicatePolicy = z.infer<typeof savedReplyDuplicatePolicySchema>;

/** The `options` field of the multipart form (a JSON string). */
export const savedReplyImportOptionsSchema = z.object({
  /** What to do with a row whose shortcut a shared reply already uses: leave that reply as it is, or replace its text. */
  duplicatePolicy: savedReplyDuplicatePolicySchema.default('skip'),
  /** Report what would happen and write nothing. */
  dryRun: z.boolean().default(false),
});
export type SavedReplyImportOptions = z.infer<typeof savedReplyImportOptionsSchema>;

export const SAVED_REPLY_IMPORT_ISSUES = [
  'missing_shortcut',
  'shortcut_invalid',
  'missing_title',
  'title_too_long',
  'missing_body',
  'body_too_long',
  'control_characters',
  'category_too_long',
  'language_invalid',
  'channel_unknown',
  'duplicate_in_file',
  'plan_limit_reached',
] as const;
export type SavedReplyImportIssue = (typeof SAVED_REPLY_IMPORT_ISSUES)[number];

export const SAVED_REPLY_IMPORT_ACTIONS = ['create', 'update', 'skip', 'invalid'] as const;

export const savedReplyImportRowSchema = z.object({
  /** 1-based line in the file, header included. */
  line: z.number().int(),
  shortcut: z.string(),
  action: z.enum(SAVED_REPLY_IMPORT_ACTIONS),
  /** Why a row is `invalid`, or `skip`ped (`duplicate` = the shortcut exists and the policy is skip). */
  issue: z.enum([...SAVED_REPLY_IMPORT_ISSUES, 'duplicate']).nullable(),
});

export const savedReplyImportResultSchema = z.object({
  dryRun: z.boolean(),
  duplicatePolicy: savedReplyDuplicatePolicySchema,
  totals: z.object({
    rows: z.number().int(),
    create: z.number().int(),
    update: z.number().int(),
    skip: z.number().int(),
    invalid: z.number().int(),
  }),
  /** The rows that are not a plain create (every problem first), capped at SAVED_REPLY_IMPORT_ROWS_SHOWN. */
  rows: z.array(savedReplyImportRowSchema),
  rowsTruncated: z.boolean(),
  /** The plan's `saved_replies` limit (null = unlimited) and what the workspace holds now. */
  plan: z.object({
    limit: z.number().int().nullable(),
    used: z.number().int(),
    remaining: z.number().int().nullable(),
  }),
});
export type SavedReplyImportResult = z.infer<typeof savedReplyImportResultSchema>;
