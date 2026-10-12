import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ConsentAction,
  type ConsentChannel,
  type ConsentEvent,
  type ConsentEventsQuery,
  type ConsentPurpose,
  type ConsentSource,
  type ConsentStateRow,
  type ContactConsent,
  type RecordConsentInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ConsentRepository, type EventRow } from './consent.repository';
import { CONSENT_CSV_HEADER, cleanEvidence, csvLine, flagAfter, transition } from './consent.rules';

const MODULE_KEY = 'contact_consent';

export interface RecordEventInput {
  contactId: number;
  channel: ConsentChannel;
  purpose?: ConsentPurpose;
  action: ConsentAction;
  source: ConsentSource;
  evidence?: Record<string, unknown>;
  actorUserId?: number | null;
  note?: string | null;
  occurredAt?: Date;
  /** One per source event; a repeat inserts nothing. */
  idempotencyKey: string;
  /** A grant from a form or an import must not override a withdrawal the contact made themselves. */
  respectWithdrawn?: boolean;
  /** Also announce `contact.opt_in` (webhooks, flows) when the contact flag really changed. */
  announceOptIn?: boolean;
}

export interface RecordOutcome {
  /** The event was stored (false: a redelivery, or a grant skipped over a withdrawal). */
  recorded: boolean;
  /** The channel's state really changed. */
  stateChanged: boolean;
  /** The contact's roll-up flag really changed. */
  flagChanged: boolean;
  eventId: string | null;
}

const NOTHING: RecordOutcome = {
  recorded: false,
  stateChanged: false,
  flagChanged: false,
  eventId: null,
};

/**
 * The consent ledger (spec docs/specs/contact-consent-ledger.md). An event is appended, the per-channel state and the contact's
 * `is_unsubscribed` roll-up are written in the SAME transaction, together with the audit row and the outbox event.
 */
@Injectable()
export class ContactConsentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConsentRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Core write. Must run inside a request context (the audit row reads it) and a tenant transaction. */
  async recordInTx(tx: Tx, orgId: number, input: RecordEventInput): Promise<RecordOutcome> {
    const purpose = input.purpose ?? 'marketing';
    const occurredAt = input.occurredAt ?? new Date();
    const prior = await this.repo.lockState(tx, orgId, input.contactId, input.channel, purpose);
    if (input.respectWithdrawn && input.action === 'granted' && prior?.state === 'withdrawn') {
      return NOTHING;
    }
    const ev = await this.repo.insertEvent(tx, orgId, {
      contactId: input.contactId,
      channel: input.channel,
      purpose,
      action: input.action,
      source: input.source,
      evidence: cleanEvidence(input.evidence),
      actorUserId: input.actorUserId ?? null,
      note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
      occurredAt,
      idempotencyKey: input.idempotencyKey,
    });
    if (!ev) return NOTHING;

    const t = transition(prior, input.action, occurredAt);
    let flagChanged = false;
    if (t.nextState) {
      await this.repo.upsertState(tx, orgId, {
        contactId: input.contactId,
        channel: input.channel,
        purpose,
        state: t.nextState,
        eventId: ev.id,
        occurredAt,
      });
      if (purpose === 'marketing') {
        const anyWithdrawn = await this.repo.anyWithdrawn(tx, orgId, input.contactId);
        const flag = flagAfter(input.action, prior?.state, anyWithdrawn);
        if (flag !== null) {
          flagChanged = await this.repo.setContactFlag(
            tx,
            orgId,
            input.contactId,
            flag,
            occurredAt,
          );
        }
      }
    }

    const contactUuid = await this.repo.contactUuid(tx, orgId, input.contactId);
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: input.contactId,
      action: 'insert',
      delta: {
        consent: { old: prior?.state ?? 'unknown', new: t.nextState ?? prior?.state ?? 'unknown' },
      },
    });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: input.contactId,
      orgId,
      eventType:
        input.action === 'granted' ? 'contact.consent.granted' : 'contact.consent.withdrawn',
      payload: {
        contactId: contactUuid,
        channel: input.channel,
        purpose,
        source: input.source,
        eventId: ev.uuid,
      },
    });
    if (input.announceOptIn && flagChanged) {
      await this.outbox.emit(tx, {
        aggregateModule: 'contacts',
        aggregateId: input.contactId,
        orgId,
        eventType: 'contact.opt_in',
        payload: {
          contactId: contactUuid,
          optedIn: input.action === 'granted',
          action: input.action === 'granted' ? 'resubscribed' : 'unsubscribed',
          source: input.source === 'keyword' ? 'stop_keyword' : input.source,
        },
      });
    }
    return { recorded: true, stateChanged: t.stateChanged, flagChanged, eventId: ev.uuid };
  }

  /** A person records consent for a contact (the profile toggle, the REST API). */
  async record(
    contactUuid: string,
    input: RecordConsentInput,
    idempotencyKey?: string,
  ): Promise<ContactConsent> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    if (input.action === 'granted' && !(input.note ?? '').trim()) {
      throw new AppError(
        ERROR_CODES.CONSENT_NOTE_REQUIRED,
        'Say why the contact agreed (what they said or signed, and where) before recording consent.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.db.tx(async (tx) => {
      const c = await this.repo.contactByUuid(tx, orgId, contactUuid);
      if (!c) {
        throw new AppError(
          ERROR_CODES.CONSENT_CONTACT_NOT_FOUND,
          'Contact not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const key = idempotencyKey
        ? `${input.source}:${idempotencyKey}`
        : `${input.source}:${randomUUID()}`;
      const seen = idempotencyKey ? await this.repo.eventByKey(tx, orgId, key) : null;
      if (seen) {
        if (
          seen.contactId !== c.id ||
          seen.action !== input.action ||
          seen.channel !== input.channel
        ) {
          throw new AppError(
            ERROR_CODES.CONSENT_IDEMPOTENCY_MISMATCH,
            'This Idempotency-Key was used for a different consent event.',
            HttpStatus.CONFLICT,
          );
        }
        return;
      }
      await this.recordInTx(tx, orgId, {
        contactId: c.id,
        channel: input.channel,
        purpose: input.purpose,
        action: input.action,
        source: input.source,
        evidence: input.evidence,
        actorUserId: ctx.actorType === 'user' ? ctx.userId : null,
        note: input.note ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        idempotencyKey: key,
        announceOptIn: true,
      });
    });
    return this.forContact(contactUuid, { limit: 50 });
  }

  /** The Consent card: the state per channel, the roll-up, and the newest events. */
  async forContact(
    contactUuid: string,
    q: Pick<ConsentEventsQuery, 'limit' | 'cursor'>,
  ): Promise<ContactConsent> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const c = await this.repo.contactByUuid(tx, orgId, contactUuid);
      if (!c) {
        throw new AppError(
          ERROR_CODES.CONSENT_CONTACT_NOT_FOUND,
          'Contact not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const [states, rows, optedOut] = await Promise.all([
        this.repo.statesOf(tx, orgId, c.id),
        this.repo.listEvents(tx, orgId, {
          contactId: c.id,
          after: decodeCursor(q.cursor),
          limit: q.limit,
        }),
        this.repo.isUnsubscribed(tx, orgId, c.id),
      ]);
      const st: ConsentStateRow[] = states.map((s) => ({
        channel: s.channel as ConsentChannel,
        purpose: s.purpose as ConsentPurpose,
        state: s.state as 'granted' | 'withdrawn',
        since: s.lastOccurredAt,
      }));
      return { contactId: contactUuid, optedOut, states: st, events: rows.map(toEvent) };
    });
  }

  /** The workspace's ledger, newest first, cursor paged. */
  async list(q: ConsentEventsQuery): Promise<{
    data: ConsentEvent[];
    page: { nextCursor: string | null; hasMore: boolean; limit: number };
  }> {
    const orgId = RequestContextStore.orgId();
    const rows = await this.db.tx((tx) =>
      this.repo.listEvents(tx, orgId, {
        channel: q.channel,
        action: q.action,
        source: q.source,
        after: decodeCursor(q.cursor),
        limit: q.limit + 1,
      }),
    );
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map(toEvent),
      page: { nextCursor: hasMore && last ? encodeCursor(last) : null, hasMore, limit: q.limit },
    };
  }

  /** CSV proof for one contact (`contactUuid`) or the workspace, formula-injection safe. Capped; see EXPORT_MAX. */
  async exportCsv(contactUuid?: string): Promise<{ csv: string; truncated: boolean }> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      let contactId: number | undefined;
      if (contactUuid) {
        const c = await this.repo.contactByUuid(tx, orgId, contactUuid);
        if (!c) {
          throw new AppError(
            ERROR_CODES.CONSENT_CONTACT_NOT_FOUND,
            'Contact not found',
            HttpStatus.NOT_FOUND,
          );
        }
        contactId = c.id;
      }
      const rows = await this.repo.listEvents(tx, orgId, { contactId, limit: EXPORT_MAX + 1 });
      const truncated = rows.length > EXPORT_MAX;
      const lines = [CONSENT_CSV_HEADER.join(',')];
      for (const r of rows.slice(0, EXPORT_MAX)) {
        lines.push(
          csvLine([
            r.contactUuid ?? '(erased)',
            r.channel,
            r.purpose,
            r.action,
            r.source,
            r.occurredAt,
            r.recordedAt,
            r.actorName ?? '',
            r.note ?? '',
            JSON.stringify(r.evidence),
          ]),
        );
      }
      return { csv: `${lines.join('\r\n')}\r\n`, truncated };
    });
  }
}

/** The most rows one synchronous export carries; a larger ledger is exported in slices by date (async export is a backlog item). */
export const EXPORT_MAX = 50_000;

function toEvent(r: EventRow): ConsentEvent {
  return {
    id: r.uuid,
    contactId: r.contactUuid,
    channel: r.channel as ConsentChannel,
    purpose: r.purpose as ConsentPurpose,
    action: r.action as ConsentAction,
    source: r.source as ConsentSource,
    evidence: r.evidence,
    actor: r.actorUuid ? { id: r.actorUuid, name: r.actorName } : null,
    note: r.note,
    occurredAt: r.occurredAt,
    recordedAt: r.recordedAt,
  };
}

function encodeCursor(r: EventRow): string {
  return Buffer.from(String(r.id)).toString('base64url');
}

function decodeCursor(c: string | undefined): number | null {
  if (!c) return null;
  const n = Number(Buffer.from(c, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(n) || n <= 0) throw AppError.validation('Invalid cursor');
  return n;
}
