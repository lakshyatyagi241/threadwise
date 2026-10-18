import type { SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { PrivacyErasureLine, PrivacyHistoryMode } from '@crm/contracts';

/**
 * The personal-data registry (spec docs/specs/privacy-and-data-governance.md section 4.5, backlog BL-142).
 *
 * One `HolderManifest` per place a person's data lives. A holder names every table it owns that points at a person (how the rows link
 * to the person, which columns hold personal values, which columns hold object-storage keys), what an erasure does with the rows, and
 * the two handlers every holder has: `export(ctx, subject)` and `erase(ctx, subject, mode)`. Both are generated from the declaration
 * by `defineHolder` (registry/define.ts), so declaring a table is enough to export it and to erase it.
 *
 * The enforcement is `test/integration/privacy/registry.spec.ts`: it reads the migrated schema and fails when a table that links to a
 * contact (or holds a phone, an email, an address of a person) is neither registered here nor listed in `allowlist.ts` with a written
 * reason, when a declaration names a column or a foreign key that does not exist, or when a registered table has disappeared.
 */

/**
 * Whose data a holder keeps. `user` is a staff member of the workspace: only the derived copies a staff member leaves behind (revenue
 * export files, AI briefs) are erased through the registry so far (`PersonalDataErasureService.eraseStaff`); the rest of the staff
 * subject (login, sessions) is a follow-up, see the wiring map.
 */
export type SubjectKind = 'contact' | 'lead' | 'user';

/** What kind of personal data a table keeps (the classes of spec section 4.7). */
export type DataCategory =
  | 'identifier'
  | 'contact'
  | 'content'
  | 'communications'
  | 'financial'
  | 'voice'
  | 'location'
  | 'attribution'
  | 'behaviour'
  | 'ai_inference'
  | 'special_risk';

/**
 * Which erasure scope a table belongs to. A rights erasure runs every tier. Deleting a contact in the CRM runs `core` and `history`
 * only (the contact row itself, tier `subject`, is deleted by the CRM's own delete, which decides races and writes the audit row): the
 * person's conversations, files and recordings go with the contact, while leads, deals, tasks and financial records stay as the
 * business records they are (they are anonymised only when a data request asks for it).
 */
export type Tier = 'subject' | 'core' | 'history' | 'records' | 'financial';

/** How a table's rows point at the person. */
export type Link =
  /** The contact's own row (`contacts.id`). */
  | { by: 'self'; column: string }
  /** A column holding `contacts.id`. */
  | { by: 'contact'; column: string }
  /** A column holding `contacts.uuid`. */
  | { by: 'contact_uuid'; column: string }
  /** A column holding `leads.id`. */
  | { by: 'lead'; column: string }
  /** A column holding the id of a conversation of the person. */
  | { by: 'conversation'; column: string }
  /** A column holding the id of a message of one of the person's conversations. */
  | { by: 'message'; column: string }
  /** A column holding `conversations.uuid`. */
  | { by: 'conversation_uuid'; column: string }
  /** A phone number: compared by its digits against every number the person has. */
  | { by: 'phone'; column: string }
  /** An email address: compared lower-cased against every address the person has. */
  | { by: 'email'; column: string }
  /** A column holding `users.id` of a staff member (a subject of kind `user`; matches nothing for a contact). */
  | { by: 'user'; column: string }
  /** An email address compared lower-cased against the address of the staff member (`userEmails`), never against a contact's. */
  | { by: 'user_email'; column: string }
  /** A column holding the key of a row of another table that belongs to the person (`invoice_id` of the person's invoices). */
  | { by: 'via'; column: string; table: string; key: string; link: Link | readonly Link[] }
  /** Anything the other kinds cannot say; `column` names the main column so the registry test can check it exists. */
  | { by: 'custom'; column: string; predicate: (subject: ResolvedSubject) => SQL };

/** What an anonymisation writes into a column. */
export type Replacement =
  /** The visible tombstone `[erased]` (text columns). */
  | 'tombstone'
  | 'null'
  /** `'{}'::jsonb` for a NOT NULL jsonb column. */
  | 'empty_object'
  | 'empty_array'
  | 'false'
  | 'now'
  /** An empty string, for a NOT NULL text column that must keep a value. */
  | 'empty_text'
  /** `erased:<row uuid>`: a value that must stay unique per row (a conversation's peer key). */
  | 'erased_uuid'
  /** A fixed word the column's check constraint allows (a status such as `ended`). Never a personal value. */
  | { text: string };

export type AnonymiseSet = Readonly<Record<string, Replacement>>;

interface TableSpecBase {
  table: string;
  /** One way of pointing at the person, or several (a row belongs to the person when ANY holds). */
  link: Link | readonly Link[];
  /** Where the table sits in the erasure scope. */
  tier: Tier;
  categories: readonly DataCategory[];
  /** Columns that hold the person's values (names, numbers, free text). Each must exist; the export masks nothing, the erasure clears them. */
  pii: readonly string[];
  /** One line: how long the rows live today and why. */
  retention: string;
  /** Object-storage locators. Collected for the purge queue BEFORE the rows go or are cleared, whatever the disposition. */
  storage?: readonly { column: string; note: string }[];
  /** Columns left out of the export (hashes, sealed tokens, internal secrets). Anything named like a secret is left out as well. */
  exportOmit?: readonly string[];
  /** Rows exported at most; the section says when it was cut. */
  exportCap?: number;
  /** Execution order, ascending. Default 50. A table read through another (events through messages) must run before it. */
  order?: number;
  /** Extra condition the rows must meet to belong to the person (SQL fragment on the table, e.g. a type column). */
  where?: SQL;
  /**
   * The rows put in the person's export, when that is narrower than the rows an erasure removes (default: `link`). A derived copy that
   * an erasure purges only because it MAY have been built from the person's data (a revenue export file that could list a buyer, a brief
   * of the company they belong to) is not their own data: it is never put in their export, and never exposes another member's rows.
   */
  exportLink?: Link | readonly Link[];
  /** An erasure that removes rows of this table writes one audit row (module = the table, the count only, never a value). */
  audited?: boolean;
}

/** The rows are deleted. In `anonymise` history mode, `whenAnonymising` is applied instead (the rows are kept without the person's identity). */
export interface DeleteSpec extends TableSpecBase {
  disposition: 'delete';
  whenAnonymising?: AnonymiseSet | 'keep';
}

/** The rows are kept and the person's values are replaced. `legalHold` says why the row stays at all. */
export interface AnonymiseTableSpec extends TableSpecBase {
  disposition: 'anonymise';
  set: AnonymiseSet;
  legalHold?: LegalHold;
}

/** The database removes the rows when `parent` is deleted (verified against the foreign keys by the registry test). */
export interface CascadeSpec extends TableSpecBase {
  disposition: 'cascade';
  parent: string;
  /** The parent is kept (anonymised) in `anonymise` history mode, so these link rows stay with it. */
  parentKeptWhenAnonymising?: boolean;
}

/** The foreign key sets the link to NULL when the person's row goes: the row is kept and no longer points at the person. It holds no identifying value of its own. */
export interface FkNullSpec extends TableSpecBase {
  disposition: 'fk_null';
  parent: string;
  reason: string;
}

/** The rows are kept as they are, with a written reason. */
export interface RetainSpec extends TableSpecBase {
  disposition: 'retain';
  reason: string;
  legalHold?: LegalHold;
}

export type TableSpec = DeleteSpec | AnonymiseTableSpec | CascadeSpec | FkNullSpec | RetainSpec;

/**
 * A legal-hold exemption. `financial_record`: the document stays for the statutory period (FINANCIAL_RECORD_RETENTION_YEARS, ADR-0028)
 * with the buyer's identity replaced; amounts, numbers, tax facts and dates stay.
 */
export interface LegalHold {
  rule: 'financial_record';
  reason: string;
}

export interface HolderManifest {
  /** Stable key, the same as the row in docs/threadwise-port/wiring/privacy-and-data.md. */
  key: string;
  /** Path of the owning module under apps/api/src/modules. */
  module: string;
  description: string;
  subjects: readonly SubjectKind[];
  tables: readonly TableSpec[];
}

/** The person a request is about, resolved to everything that identifies them in this workspace. */
export interface ResolvedSubject {
  orgId: number;
  contactIds: readonly number[];
  contactUuids: readonly string[];
  /** Staff members (`users.id`) of a subject of kind `user`; empty for a contact or a lead. */
  userIds: readonly number[];
  /** Lower-cased email addresses of those staff members. */
  userEmails: readonly string[];
  leadIds: readonly number[];
  conversationIds: readonly number[];
  conversationUuids: readonly string[];
  /** Every phone number the person has, as digits only (at least 7). */
  phoneDigits: readonly string[];
  /** Every email address, lower-cased. */
  emails: readonly string[];
  /** Conversation peer keys to match (digits of the phones, the emails). */
  peerKeys: readonly string[];
}

export interface PrivacyCtx {
  tx: Tx;
  orgId: number;
  /** The request an erasure belongs to; null for a contact deleted from the CRM. */
  requestId: number | null;
  /** The tiers this run covers. */
  tiers: readonly Tier[];
  /** True: count only, change nothing. */
  dryRun: boolean;
  now: Date;
}

export interface ExportedTable {
  table: string;
  /** Rows of the section, personal values included (this is the person's own data). Internal ids and secrets are removed. */
  rows: Record<string, unknown>[];
  count: number;
  truncated: boolean;
}

export interface ExportSection {
  holder: string;
  tables: ExportedTable[];
}

export interface EraseOutcome {
  holder: string;
  lines: PrivacyErasureLine[];
  /** Storage keys found (queued for deletion unless dry run). */
  files: number;
}

export interface PersonalDataHolder extends HolderManifest {
  export(ctx: PrivacyCtx, subject: ResolvedSubject): Promise<ExportSection>;
  erase(ctx: PrivacyCtx, subject: ResolvedSubject, mode: PrivacyHistoryMode): Promise<EraseOutcome>;
}
