import { Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  consentChannelOfKind,
  purposeOf,
  type ConsentGateReason,
  type ConsentGateResult,
  type ConsentModality,
  type ConsentSubject,
  type PurposeInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { ConsentPolicyService } from './consent-policy.service';
import { NO_FACTS, decideConsent, failureResult, type ConsentFacts } from './consent-gate.rules';

export interface GateOptions {
  /** The message answers something this contact sent and the customer-service window is open (see `messagePurpose`). */
  replyWindowOpen?: boolean;
  /** Run inside the caller's transaction (it is already scoped to the workspace). */
  tx?: Tx;
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
          facts: NO_FACTS,
        });
      }
      const [requireConsent, facts] = await Promise.all([
        def.ledgerPurpose === 'marketing' ? this.policy.requiresConsent(orgId) : false,
        def.ledgerPurpose
          ? this.factsOf(orgId, subject, channel, def.ledgerPurpose, options.tx)
          : NO_FACTS,
      ]);
      return decideConsent({
        purpose,
        channel,
        ...(modality ? { modality } : {}),
        requireConsent,
        ...(options.replyWindowOpen ? { replyWindowOpen: true } : {}),
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
      const ledger = options.replyWindowOpen ? null : def.ledgerPurpose;
      const requireConsent =
        def.ledgerPurpose === 'marketing' ? await this.policy.requiresConsent(orgId) : false;
      const facts = ledger
        ? await this.factsMany(orgId, unique, channel, ledger, options.tx)
        : new Map<number, ConsentFacts>();
      for (const id of unique) {
        decisions.set(
          id,
          decideConsent({
            purpose,
            channel,
            ...(modality ? { modality } : {}),
            requireConsent,
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

  // --- facts ------------------------------------------------------------------------------------------------------------------

  private async factsOf(
    orgId: number,
    subject: ConsentSubject,
    channel: string,
    ledgerPurpose: 'marketing' | 'utility',
    tx?: Tx,
  ): Promise<ConsentFacts> {
    if (subject.type === 'anonymous') return NO_FACTS;
    const where: SQL =
      subject.type === 'contact'
        ? sql`c.id = ${subject.id}`
        : subject.type === 'contact_uuid'
          ? sql`c.uuid = ${subject.uuid}::uuid`
          : phoneMatch(subject.phone);
    const rows = await this.run(orgId, tx, (t) =>
      this.factRows(t, orgId, where, channel, ledgerPurpose),
    );
    // A phone can belong to more than one contact: any withdrawal wins, then any grant.
    const merged: ConsentFacts = { unsubscribedFlag: false, ledgerState: 'unknown' };
    for (const r of rows) {
      if (r.flag) merged.unsubscribedFlag = true;
      if (r.state === 'withdrawn') merged.ledgerState = 'withdrawn';
      else if (r.state === 'granted' && merged.ledgerState !== 'withdrawn') {
        merged.ledgerState = 'granted';
      }
    }
    return merged;
  }

  private async factsMany(
    orgId: number,
    ids: readonly number[],
    channel: string,
    ledgerPurpose: 'marketing' | 'utility',
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
        });
      }
    }
    return out;
  }

  /** One statement: the flag and the ledger state of every matched contact. */
  private async factRows(
    tx: Tx,
    orgId: number,
    where: SQL,
    channel: string,
    ledgerPurpose: 'marketing' | 'utility',
  ): Promise<Array<{ id: number; flag: boolean; state: string | null }>> {
    const consentChannel = consentChannelOfKind(channel);
    const res = await tx.execute(sql`
      SELECT c.id, c.is_unsubscribed AS flag, cs.state
      FROM contacts c
      LEFT JOIN contact_consent_state cs
        ON cs.org_id = c.org_id AND cs.contact_id = c.id
       AND cs.channel = ${consentChannel ?? ''} AND cs.purpose = ${ledgerPurpose}
      WHERE c.org_id = ${orgId} AND ${where}`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      flag: r.flag === true,
      state: (r.state as string | null) ?? null,
    }));
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

function summarise(decisions: Map<number, ConsentGateResult>): GateManyResult {
  const allowed = new Set<number>();
  const counts: Partial<Record<ConsentGateReason, number>> = {};
  for (const [id, d] of decisions) {
    if (d.decision === 'allow') allowed.add(id);
    counts[d.reason] = (counts[d.reason] ?? 0) + 1;
  }
  return { decisions, allowed, counts };
}

/** Contacts whose number is these digits, with or without the country code (the same match the schedule audience uses). */
function phoneMatch(phone: string): SQL {
  const digits = phone.replace(/[^0-9]/g, '');
  return sql`(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = ${digits}
    OR regexp_replace(coalesce(c.country_code, '') || coalesce(c.phone, ''), '[^0-9]', '', 'g') = ${digits})`;
}
