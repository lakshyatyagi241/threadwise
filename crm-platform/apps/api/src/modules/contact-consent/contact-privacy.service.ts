import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  isUnderAge,
  minorRuleOf,
  type ContactPrivacy,
  type PrivacyFlagEvent,
  type PrivacyFlagKind,
  type PrivacyFlagSource,
  type RecordPrivacyFlagInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ConsentRepository } from './consent.repository';
import { cleanEvidence } from './consent.rules';
import { ContactPrivacyRepository, type PrivacyEventRow } from './contact-privacy.repository';
import { planFlagChange, type FlagsState } from './contact-privacy.rules';

const MODULE_KEY = 'contact_privacy';
/** How many changes the Consent card shows. */
const EVENTS_SHOWN = 20;

export interface PrivacyChangeInput {
  contactId: number;
  kind: PrivacyFlagKind;
  value: boolean;
  source: PrivacyFlagSource;
  evidence?: Record<string, unknown>;
  actorUserId?: number | null;
  note?: string | null;
  occurredAt?: Date;
  /** One per source event; a repeat inserts nothing. */
  idempotencyKey: string;
  /** Append nothing when the flag already has this value (the browser signal repeats on every submission). */
  onlyIfChanged?: boolean;
  /** `minor` on with source `dob`: the day the flag lapses by itself (see `minorUntilForBirth`, `minorUntilForAge`). */
  minorUntil?: string | null;
}

export interface PrivacyChangeOutcome {
  /** The change was stored. */
  recorded: boolean;
  /** The requested flag really changed value. */
  changed: boolean;
  /** Guardian consent was refused because the contact is not flagged as a minor. */
  notMinor?: boolean;
  /** The system (source `dob`) left a flag alone that a person, the API, an import or a flow had set. */
  kept?: boolean;
}

const NOTHING: PrivacyChangeOutcome = { recorded: false, changed: false };

/**
 * The contact privacy flags (BL-180, spec docs/specs/privacy-and-data-governance.md section 11.9): minor, guardian consent, and Do Not
 * Sell or Share. The same shape as the consent ledger: an event is appended and the current value is written in the SAME transaction,
 * with the audit row and the outbox event. Nothing here writes a marketing grant.
 */
@Injectable()
export class ContactPrivacyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactPrivacyRepository,
    private readonly consentRepo: ConsentRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Core write. Must run inside a request context (the audit row reads it) and a tenant transaction. */
  async changeInTx(
    tx: Tx,
    orgId: number,
    input: PrivacyChangeInput,
  ): Promise<PrivacyChangeOutcome> {
    const occurredAt = clampToNow(input.occurredAt);
    const prior = await this.repo.lockFlags(tx, orgId, input.contactId);
    // A person clearing the flag while the date of birth still says "minor": remember the date, so the sweep does not undo their decision.
    let dobSaysMinorFor: string | null = null;
    if (input.kind === 'minor' && !input.value && input.source !== 'dob' && prior.isMinor) {
      const dob = await this.repo.dateOfBirth(tx, orgId, input.contactId);
      if (dob) {
        const facts = await this.repo.complianceFacts(tx, orgId);
        if (isUnderAge(dob, facts.minorAge, occurredAt)) dobSaysMinorFor = dob;
      }
    }
    const plan = planFlagChange(prior, input.kind, input.value, input.source, occurredAt, {
      minorUntil: input.minorUntil ?? null,
      dobSaysMinorFor,
    });
    if (!plan.ok) {
      return plan.reason === 'person_flag'
        ? { recorded: false, changed: false, kept: true }
        : { recorded: false, changed: false, notMinor: true };
    }
    if (input.onlyIfChanged && !plan.changed) return NOTHING;

    const evidence = cleanEvidence(input.evidence);
    const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
    const eventIds: string[] = [];
    for (const [i, step] of plan.steps.entries()) {
      const ev = await this.repo.insertEvent(tx, orgId, {
        contactId: input.contactId,
        kind: step.kind,
        value: step.value,
        source: input.source,
        // The cascaded step (guardian cleared with the minor flag) carries no evidence of its own.
        evidence: i === 0 ? evidence : {},
        actorUserId: input.actorUserId ?? null,
        note: i === 0 ? note : null,
        occurredAt,
        idempotencyKey: i === 0 ? input.idempotencyKey : `${input.idempotencyKey}#${step.kind}`,
      });
      // A redelivery: the first line is already stored, so nothing else is written either.
      if (!ev) return NOTHING;
      eventIds.push(ev.uuid);
    }
    await this.repo.saveFlags(tx, orgId, input.contactId, plan.next);

    const contactUuid = await this.consentRepo.contactUuid(tx, orgId, input.contactId);
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: input.contactId,
      action: 'update',
      delta: Object.fromEntries(
        plan.steps.map((s) => [s.kind, { old: valueOf(prior, s.kind), new: s.value }]),
      ),
    });
    for (const [i, step] of plan.steps.entries()) {
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: input.contactId,
        orgId,
        eventType: 'contact.privacy.changed',
        payload: {
          contactId: contactUuid,
          kind: step.kind,
          value: step.value,
          source: input.source,
          eventId: eventIds[i],
        },
      });
    }
    return { recorded: true, changed: plan.changed };
  }

  /** Which of these contacts (by uuid) are flagged as minors (the customer API's contact list). */
  minorUuids(tx: Tx, orgId: number, uuids: readonly string[]): Promise<Set<string>> {
    return this.repo.minorUuids(tx, orgId, uuids);
  }

  /** The age below which a person is a minor in this workspace (BL-211): the highest of the profiles' ages, else 18. */
  async minorAge(tx: Tx, orgId: number): Promise<number> {
    return (await this.repo.complianceFacts(tx, orgId)).minorAge;
  }

  /** What a form's or a widget's age settings explain themselves with (BL-211): the minor age, and whether the children question is answered. */
  async ageContext(
    tx: Tx,
    orgId: number,
  ): Promise<{ workspaceMinorAge: number; childrenAnswered: boolean }> {
    const facts = await this.repo.complianceFacts(tx, orgId);
    return {
      workspaceMinorAge: facts.minorAge,
      childrenAnswered: facts.childrenPolicy !== 'unset' || facts.parentalConsentRequired,
    };
  }

  /** A person (or an API caller) turns a flag on or off for a contact. */
  async record(
    contactUuid: string,
    input: RecordPrivacyFlagInput,
    idempotencyKey?: string,
  ): Promise<void> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    if (input.kind === 'guardian_consent' && input.value && !(input.note ?? '').trim()) {
      throw new AppError(
        ERROR_CODES.CONSENT_NOTE_REQUIRED,
        'Say how the parent or guardian agreed (what they said or signed, and where) before recording it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.db.tx(async (tx) => {
      const c = await this.consentRepo.contactByUuid(tx, orgId, contactUuid);
      if (!c) {
        throw new AppError(
          ERROR_CODES.CONSENT_CONTACT_NOT_FOUND,
          'Contact not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const key = idempotencyKey
        ? `${input.source}:privacy:${idempotencyKey}`
        : `${input.source}:privacy:${randomUUID()}`;
      const seen = idempotencyKey ? await this.repo.eventByKey(tx, orgId, key) : null;
      if (seen) {
        if (seen.contactId !== c.id || seen.kind !== input.kind || seen.value !== input.value) {
          throw new AppError(
            ERROR_CODES.CONSENT_IDEMPOTENCY_MISMATCH,
            'This Idempotency-Key was used for a different privacy change.',
            HttpStatus.CONFLICT,
          );
        }
        return;
      }
      const out = await this.changeInTx(tx, orgId, {
        contactId: c.id,
        kind: input.kind,
        value: input.value,
        source: input.source,
        evidence: input.evidence,
        actorUserId: ctx.actorType === 'user' ? ctx.userId : null,
        note: input.note ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        idempotencyKey: key,
      });
      if (out.notMinor) {
        throw new AppError(
          ERROR_CODES.CONSENT_PRIVACY_NOT_MINOR,
          'Guardian consent can only be recorded for a contact marked as a minor.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    });
  }

  /**
   * The Global Privacy Control signal reached a public door (a form submission or a chat widget message) that belongs to this contact:
   * record the "Do Not Sell or Share" opt-out, but ONLY when the workspace has the `ccpa_us` profile on. An opt-out already on is not
   * written again. Returns whether a new opt-out was recorded. The signal is the browser's statement of the person's choice, so it is
   * recorded for the contact the submission resolved to and nothing else about the request (no IP, no user agent) is kept.
   */
  async recordGpc(
    tx: Tx,
    orgId: number,
    contactId: number,
    door: { keyBase: string; evidence: Record<string, unknown> },
  ): Promise<boolean> {
    const facts = await this.repo.complianceFacts(tx, orgId);
    if (!facts.ccpaUs) return false;
    const write = () =>
      this.changeInTx(tx, orgId, {
        contactId,
        kind: 'sale_share_opt_out',
        value: true,
        source: 'gpc',
        evidence: door.evidence,
        actorUserId: null,
        note: null,
        idempotencyKey: `gpc:${door.keyBase}`,
        onlyIfChanged: true,
      });
    // The audit row names the context's workspace and actor. A public page has none of its own (no user, no tenant until the form key
    // or the widget token was looked up): it acts as the system of THIS workspace, the way the consent intake does.
    const current = RequestContextStore.peek();
    const out =
      current && current.orgId === orgId
        ? await write()
        : await RequestContextStore.run(
            {
              requestId: `gpc-${randomUUID()}`,
              orgId,
              actorType: 'system',
              actorId: null,
              userId: null,
            },
            write,
          );
    return out.recorded;
  }

  /** The flags of one contact, the workspace facts that explain them, and the newest changes (the Consent card). */
  async forContactIn(tx: Tx, orgId: number, contactId: number): Promise<ContactPrivacy> {
    const [flags, facts, events] = await Promise.all([
      this.repo.flagsOf(tx, orgId, contactId),
      this.repo.complianceFacts(tx, orgId),
      this.repo.listEvents(tx, orgId, contactId, EVENTS_SHOWN),
    ]);
    return {
      isMinor: flags.isMinor,
      minorSince: flags.minorSince,
      minorSource: flags.minorSource,
      guardianConsent: flags.guardianConsent,
      guardianSince: flags.guardianSince,
      minorUntil: flags.minorSource === 'dob' ? flags.minorUntil : null,
      doNotSellShare: flags.doNotSellShare,
      doNotSellShareSince: flags.doNotSellShareSince,
      doNotSellShareSource: flags.doNotSellShareSource,
      ccpaUs: facts.ccpaUs,
      minorRule: minorRuleOf(facts.childrenPolicy, facts.parentalConsentRequired),
      events: events.map(toEvent),
    };
  }
}

function valueOf(s: FlagsState, kind: PrivacyFlagKind): boolean {
  switch (kind) {
    case 'minor':
      return s.isMinor;
    case 'guardian_consent':
      return s.guardianConsent;
    case 'sale_share_opt_out':
      return s.doNotSellShare;
  }
}

/** An `occurredAt` in the future is clamped to now: nobody records a change that has not happened. */
function clampToNow(at: Date | undefined): Date {
  const now = new Date();
  return at && at.getTime() < now.getTime() ? at : now;
}

function toEvent(r: PrivacyEventRow): PrivacyFlagEvent {
  return {
    id: r.uuid,
    contactId: r.contactUuid,
    kind: r.kind as PrivacyFlagKind,
    value: r.value,
    source: r.source as PrivacyFlagSource,
    evidence: r.evidence,
    actor: r.actorUuid ? { id: r.actorUuid, name: r.actorName } : null,
    note: r.note,
    occurredAt: r.occurredAt,
    recordedAt: r.recordedAt,
  };
}
