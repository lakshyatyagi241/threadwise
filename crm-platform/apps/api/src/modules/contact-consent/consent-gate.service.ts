import { Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  consentChannelOfKind,
  purposeOf,
  type ConsentGateReason,
  type ConsentGateResult,
  type ConsentModality,
  type ConsentNoticeEvidence,
  type ConsentSubject,
  type PurposeDefinition,
  type PurposeInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { ConsentPolicyService } from './consent-policy.service';
import {
  NO_FACTS,
  RESTRICTED_PURPOSES,
  decideConsent,
  failureResult,
  isDncChannel,
  type ConsentFacts,
} from './consent-gate.rules';

export interface GateOptions {
  /** The message answers something this contact sent and the customer-service window is open (see `messagePurpose`). */
  replyWindowOpen?: boolean;
  /** Run inside the caller's transaction (it is already scoped to the workspace). */
  tx?: Tx;
  /** The workspace switch for the purpose (call recording). False answers `purpose_not_enabled` before anything else. */
  purposeEnabled?: boolean;
  /** The delivered notice and the person's answer, for a notice-first purpose (call recording, AI disclosure). */
  noticeEvidence?: ConsentNoticeEvidence;
}

export interface GateManyOptions {
  tx?: Tx;
  replyWindowOpen?: boolean;
}

export interface GateManyResult {
  /** One decision per requested contact id. */
  decisions: Map<number, ConsentGateResult>;
  /** The ids that may be messaged. */
  allowed: Set<number>;
  /** How many contacts got each reason, for the skip counters of a send. */
  counts: Partial<Record<ConsentGateReason, number>>;
}

const CHUNK = 1000;
/** A database error is logged once per this long (per process), so a broken database does not flood the log with one line per send. */
const LOG_EVERY_MS = 60_000;

type Raw = Record<string, unknown>;

/**
 * The ConsentGate (spec docs/specs/privacy-and-data-governance.md section 4.3): the one door every send and every processing path asks
 * "may I contact this person, for this purpose, on this channel?". It answers `allow`, `deny` or `needs_notice` with a reason from a
 * closed set (`CONSENT_GATE_REASONS`), so a skip can always be explained.
 *
 * The rule is `decideConsent` (pure, unit tested). This class only collects the facts: the roll-up flag and the ledger state, in ONE
 * statement for a whole audience (`checkMany`), never one query per contact.
 *
 * Failure: a database error never silently allows marketing. Marketing and other consent-based purposes fail CLOSED
 * (`gate_unavailable_closed`); service replies fail OPEN (`gate_unavailable_open`) because refusing a customer's reply on a
 * bookkeeping outage hurts them and protects nobody. The error is logged once a minute.
 */
@Injectable()
export class ConsentGate {
  private readonly logger = new Logger(ConsentGate.name);
  private lastLoggedAt = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly policy: ConsentPolicyService,
  ) {}

  async check(
    orgId: number,
    subject: ConsentSubject,
    channel: string,
    purpose: PurposeInput,
    modality?: ConsentModality,
    options: GateOptions = {},
  ): Promise<ConsentGateResult> {
    const def = purposeOf(purpose);
    try {
      // The service reply in an open window needs no lookup at all: the hot path of a conversation costs nothing.
      if (def.ledgerPurpose === 'utility' && options.replyWindowOpen) {
        return decideConsent({
          purpose,
          channel,
          ...(modality ? { modality } : {}),
          requireConsent: false,
          replyWindowOpen: true,
          ...(options.purposeEnabled === undefined
            ? {}
            : { purposeEnabled: options.purposeEnabled }),
          facts: NO_FACTS,
        });
      }
      const marketing = def.ledgerPurpose === 'marketing';
      const [requireConsent, minorRule, facts] = await Promise.all([
        marketing ? this.policy.requiresConsent(orgId) : false,
        marketing ? this.policy.minorRule(orgId) : undefined,
        readsFacts(def)
          ? this.factsOf(orgId, subject, channel, def.ledgerPurpose, options.tx)
          : NO_FACTS,
      ]);
      return decideConsent({
        purpose,
        channel,
        ...(modality ? { modality } : {}),
        requireConsent,
        ...(minorRule ? { minorRule } : {}),
        ...(options.replyWindowOpen ? { replyWindowOpen: true } : {}),
        ...(options.purposeEnabled === undefined ? {} : { purposeEnabled: options.purposeEnabled }),
        ...(options.noticeEvidence ? { noticeEvidence: options.noticeEvidence } : {}),
        facts,
      });
    } catch (err) {
      this.logFailure(orgId, purpose, err);
      return failureResult(def);
    }
  }

  /**
   * An audience in one pass: the same rule for every contact id, with the facts of a chunk read by a single statement. The result
   * answers per id, so a caller keeps its own order, counts its skips by reason, and never loops queries.
   */
  async checkMany(
    orgId: number,
    contactIds: readonly number[],
    channel: string,
    purpose: PurposeInput,
    modality?: ConsentModality,
    options: GateManyOptions = {},
  ): Promise<GateManyResult> {
    const def = purposeOf(purpose);
    const decisions = new Map<number, ConsentGateResult>();
    const unique = [...new Set(contactIds)];
    try {
      const marketing = def.ledgerPurpose === 'marketing';
      const requireConsent = marketing ? await this.policy.requiresConsent(orgId) : false;
      const minorRule = marketing ? await this.policy.minorRule(orgId) : undefined;
      const facts =
        !options.replyWindowOpen && readsFacts(def)
          ? await this.factsMany(orgId, unique, channel, def.ledgerPurpose, options.tx)
          : new Map<number, ConsentFacts>();
      for (const id of unique) {
        decisions.set(
          id,
          decideConsent({
            purpose,
            channel,
            ...(modality ? { modality } : {}),
            requireConsent,
            ...(minorRule ? { minorRule } : {}),
            ...(options.replyWindowOpen ? { replyWindowOpen: true } : {}),
            facts: facts.get(id) ?? NO_FACTS,
          }),
        );
      }
    } catch (err) {
      this.logFailure(orgId, purpose, err);
      decisions.clear();
      for (const id of unique) decisions.set(id, failureResult(def));
    }
    return summarise(decisions);
  }

  /**
   * The purpose of sending this approved template: `marketing_messaging` for a MARKETING template, `service_messaging` otherwise (a
   * template the workspace does not have is treated as utility, the column's default). A database error counts as marketing.
   */
  async purposeOfTemplate(
    orgId: number,
    name: string,
    language: string,
    tx?: Tx,
  ): Promise<PurposeInput> {
    try {
      const res = await this.run(orgId, tx, (t) =>
        t.execute(sql`
          SELECT lower(coalesce(meta_category, category)) AS category FROM wa_templates
          WHERE org_id = ${orgId} AND template_name = ${name}
          ORDER BY (language = ${language}) DESC, id LIMIT 1`),
      );
      return purposeOfCategory((res.rows[0] as Raw | undefined)?.category as string | undefined);
    } catch (err) {
      this.logFailure(orgId, 'template category', err);
      return 'marketing_messaging';
    }
  }

  // --- facts ------------------------------------------------------------------------------------------------------------------

  private async factsOf(
    orgId: number,
    subject: ConsentSubject,
    channel: string,
    ledgerPurpose: 'marketing' | 'utility' | null,
    tx?: Tx,
  ): Promise<ConsentFacts> {
    const where = subjectMatch(subject);
    if (!where) return NO_FACTS;
    const rows = await this.run(orgId, tx, (t) =>
      this.factRows(t, orgId, where, channel, ledgerPurpose),
    );
    // A number with no contact is still a number someone may have asked us not to call (BL-181): the list is read on its own.
    if (
      rows.length === 0 &&
      subject.type === 'phone' &&
      ledgerPurpose === 'marketing' &&
      isDncChannel(channel)
    ) {
      const digits = subject.phone.replace(/[^0-9]/g, '');
      if (digits.length >= 6 && digits.length <= 15) {
        const listed = await this.run(orgId, tx, (t) => this.onDncDirect(t, orgId, digits));
        if (listed) return { ...NO_FACTS, onDncList: true };
      }
    }
    // A phone can belong to more than one contact: any withdrawal wins, then any grant.
    const merged: ConsentFacts = {
      unsubscribedFlag: false,
      ledgerState: 'unknown',
      minor: false,
      guardianConsent: false,
      saleShareOptOut: false,
      onDncList: false,
      restricted: false,
    };
    // Any matched contact that is a minor or opted out counts (the stricter reading); guardian consent must cover EVERY flagged minor.
    let minors = 0;
    let guarded = 0;
    for (const r of rows) {
      if (r.flag) merged.unsubscribedFlag = true;
      if (r.minor) {
        minors += 1;
        if (r.guardian) guarded += 1;
      }
      if (r.saleShare) merged.saleShareOptOut = true;
      if (r.onDnc) merged.onDncList = true;
      if (r.restricted) merged.restricted = true;
      if (r.state === 'withdrawn') merged.ledgerState = 'withdrawn';
      else if (r.state === 'granted' && merged.ledgerState !== 'withdrawn') {
        merged.ledgerState = 'granted';
      }
    }
    merged.minor = minors > 0;
    merged.guardianConsent = minors > 0 && guarded === minors;
    return merged;
  }

  private async factsMany(
    orgId: number,
    ids: readonly number[],
    channel: string,
    ledgerPurpose: 'marketing' | 'utility' | null,
    tx?: Tx,
  ): Promise<Map<number, ConsentFacts>> {
    const out = new Map<number, ConsentFacts>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const where = sql`c.id IN (${sql.join(
        part.map((id) => sql`${id}::bigint`),
        sql`, `,
      )})`;
      const rows = await this.run(orgId, tx, (t) =>
        this.factRows(t, orgId, where, channel, ledgerPurpose),
      );
      for (const r of rows) {
        out.set(r.id, {
          unsubscribedFlag: r.flag,
          ledgerState: r.state === 'granted' || r.state === 'withdrawn' ? r.state : 'unknown',
          minor: r.minor,
          guardianConsent: r.guardian,
          saleShareOptOut: r.saleShare,
          onDncList: r.onDnc,
          restricted: r.restricted,
        });
      }
    }
    return out;
  }

  /**
   * One statement: the flag, the ledger state and the privacy flags (minor, guardian consent, sale / share opt-out) of every matched
   * contact. The privacy flags are one primary-key lookup per contact. A purpose with no ledger purpose (third-party sharing) matches
   * no ledger row, so only the flags come back.
   */
  private async factRows(
    tx: Tx,
    orgId: number,
    where: SQL,
    channel: string,
    ledgerPurpose: 'marketing' | 'utility' | null,
  ): Promise<
    Array<{
      id: number;
      flag: boolean;
      state: string | null;
      minor: boolean;
      guardian: boolean;
      saleShare: boolean;
      onDnc: boolean;
      restricted: boolean;
    }>
  > {
    const consentChannel = consentChannelOfKind(channel);
    // The Do-Not-Call list only matters for voice and SMS marketing; for every other send the lookup is not made at all.
    const dnc =
      ledgerPurpose === 'marketing' && isDncChannel(channel)
        ? sql`EXISTS (SELECT 1 FROM dnc_entries d WHERE d.org_id = c.org_id AND d.phone_digits = regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g'))`
        : sql`false`;
    // A legal hold (BL-295): the workspace-level question is asked once per statement (an uncorrelated subquery), and the per-contact
    // function only runs when the workspace has any hold at all, so a broadcast to a workspace without holds pays one index probe.
    const res = await tx.execute(sql`
      SELECT c.id, c.is_unsubscribed AS flag, cs.state,
             coalesce(pf.is_minor, false) AS minor, coalesce(pf.guardian_consent, false) AS guardian,
             coalesce(pf.do_not_sell_share, false) AS sale_share, ${dnc} AS on_dnc,
             ((SELECT org_has_active_legal_hold(${orgId}::bigint)) AND is_subject_held(c.org_id, 'contact', c.id)) AS restricted
      FROM contacts c
      LEFT JOIN contact_consent_state cs
        ON cs.org_id = c.org_id AND cs.contact_id = c.id
       AND cs.channel = ${consentChannel ?? ''} AND cs.purpose = ${ledgerPurpose ?? ''}
      LEFT JOIN contact_privacy_flags pf ON pf.org_id = c.org_id AND pf.contact_id = c.id
      WHERE c.org_id = ${orgId} AND ${where}`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      flag: r.flag === true,
      state: (r.state as string | null) ?? null,
      minor: r.minor === true,
      guardian: r.guardian === true,
      saleShare: r.sale_share === true,
      onDnc: r.on_dnc === true,
      restricted: r.restricted === true,
    }));
  }

  /** Is this number (digits only) on the workspace's Do-Not-Call list? One unique-index lookup. */
  private async onDncDirect(tx: Tx, orgId: number, digits: string): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM dnc_entries WHERE org_id = ${orgId} AND phone_digits = ${digits}`,
    );
    return res.rows.length > 0;
  }

  private run<T>(orgId: number, tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : this.db.txAs({ orgId, userId: null }, fn);
  }

  private logFailure(orgId: number, purpose: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastLoggedAt < LOG_EVERY_MS) return;
    this.lastLoggedAt = now;
    this.logger.error(
      { orgId, purpose, err: err instanceof Error ? err.message : String(err) },
      '[CONSENT] the consent gate could not decide; marketing is refused, service replies go through',
    );
  }
}

/** Whether the decision for this purpose reads anything about the contact: the ledger, or the privacy flags (third-party sharing). */
function readsFacts(def: PurposeDefinition): boolean {
  return (
    def.ledgerPurpose !== null ||
    def.id === 'third_party_sharing' ||
    RESTRICTED_PURPOSES.has(def.id)
  );
}

function summarise(decisions: Map<number, ConsentGateResult>): GateManyResult {
  const allowed = new Set<number>();
  const counts: Partial<Record<ConsentGateReason, number>> = {};
  for (const [id, d] of decisions) {
    if (d.decision === 'allow') allowed.add(id);
    counts[d.reason] = (counts[d.reason] ?? 0) + 1;
  }
  return { decisions, allowed, counts };
}

/**
 * How a subject finds its contact row, or null when it names nobody the ledger could know (a visitor, a group, a short or empty key).
 * A phone is matched on the indexed `normalized_phone` (E.164 with its plus, or the bare digits a peer key carries), an email on
 * `normalized_email`; an empty value never matches, so an unknown peer cannot match every contact without a number.
 */
function subjectMatch(subject: ConsentSubject): SQL | null {
  switch (subject.type) {
    case 'contact':
      return sql`c.id = ${subject.id}`;
    case 'contact_uuid':
      return sql`c.uuid = ${subject.uuid}::uuid`;
    case 'phone': {
      const digits = subject.phone.replace(/[^0-9]/g, '');
      if (digits.length < 6 || digits.length > 15) return null;
      return sql`c.normalized_phone IN (${digits}, ${`+${digits}`})`;
    }
    case 'email': {
      const email = subject.email.trim().toLowerCase();
      return email.includes('@') ? sql`c.normalized_email = ${email}` : null;
    }
    default:
      return null;
  }
}

/** A template's category decides whether sending it is marketing (spec 4.3: the template category chooses the purpose). */
export function purposeOfCategory(category: string | null | undefined): PurposeInput {
  return (category ?? '').toLowerCase() === 'marketing'
    ? 'marketing_messaging'
    : 'service_messaging';
}
