import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { LeadSourceDefaults } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ContactsRepository, ContactsService, DealsService, TagsRepository } from '../crm';
import { actingUserId, runInOrg } from './lead-context';
import type { LeadIngestPort, LeadIngestResult, NormalisedLead } from './lead-ingest.port';
import { pickOwner } from './lead-assignment';
import { LeadAttributionsRepository } from './lead-attributions.repository';
import { LeadEventsRepository, type LeadEventRow } from './lead-events.repository';
import {
  boundLead,
  coerceCustomValue,
  flattenPayload,
  renderDealTitle,
  resolveLeadFields,
  type ResolvedLeadFields,
} from './lead-mapping';
import { normaliseLeadPhone, type LeadPhone } from './lead-phone';
import { LeadsPlan } from './lead-plan';
import { defaultsOf, platformLabel } from './lead-rules';
import { LeadSourcesRepository, type LeadSourceRow } from './lead-sources.repository';

const CONTACTS = 'contacts';
const LEAD_EVENTS = 'lead_events';
const MS_PER_DAY = 86_400_000;

export interface ProcessOptions {
  /** A test lead: stored and processed like any, but flagged, quiet (no `contact.created`, so no flow enrols it) and never notified. */
  isTest?: boolean;
}

export interface ProcessOutcome {
  result: LeadIngestResult;
  /** The stored event (internal id), for callers that answer with it. Absent when nothing was stored (unknown or paused source). */
  eventId?: number;
}

type ContactOutcome =
  | { kind: 'ok'; contactId: number; uuid: string; created: boolean }
  | { kind: 'review'; reason: 'plan_limit_reached' | 'invalid_phone' | 'no_contact_point' };

/**
 * The lead pipeline (spec L-01..L-10) and the ONLY writer of lead-originated contacts.
 *
 *   claim (store the delivery under its idempotency key)
 *     -> normalise and map -> a usable email or phone? (no: `needs_review`, stored, never dropped)
 *     -> identity-first dedupe -> create the contact, or UPDATE the one that matched (blanks filled, nothing curated overwritten)
 *     -> append the attribution touch -> tag -> owner (fixed or round robin)
 *     -> outbox `lead.created` / `lead.updated` (the notification consumer, `contact.created` for flows)
 *   then, in a transaction of its own because the deals service opens one: the optional deal (`lead_ad`).
 *
 * The contact, its attribution, the event's outcome, the audit rows and the outbox events commit together or not at all. A crash between
 * the claim and the outcome leaves the event `received`, and a redelivery (or the stale-claim rule) picks it up; an error rolls the
 * outcome back and is recorded as `failed` in a transaction of its own. The deal can fail alone: the lead stays created and the event
 * says why there is no deal.
 *
 * Runs as a system actor scoped to the workspace the caller proved (a hook's token, an installed connector); the payload is never
 * trusted to name a tenant. A test or a retry from the admin screen runs inside that admin's own request context, so its audit rows
 * name them.
 */
@Injectable()
export class LeadIngestService implements LeadIngestPort {
  private readonly logger = new Logger(LeadIngestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sources: LeadSourcesRepository,
    private readonly events: LeadEventsRepository,
    private readonly attributions: LeadAttributionsRepository,
    private readonly contacts: ContactsService,
    private readonly contactRepo: ContactsRepository,
    private readonly tags: TagsRepository,
    private readonly deals: DealsService,
    private readonly plan: LeadsPlan,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The port: a connector's lead for a source it holds the id of. */
  async ingest(orgId: number, sourceId: number, lead: NormalisedLead): Promise<LeadIngestResult> {
    return (await this.process(orgId, sourceId, lead, {})).result;
  }

  async process(
    orgId: number,
    sourceId: number,
    rawLead: NormalisedLead,
    opts: ProcessOptions,
  ): Promise<ProcessOutcome> {
    const lead = boundLead(rawLead);
    return runInOrg(orgId, async () => {
      const claimed = await this.db.txAs({ orgId, userId: actingUserId() }, async (tx) => {
        const source = await this.sources.findById(tx, orgId, sourceId);
        if (!source) return { kind: 'no_source' as const };
        if (source.status !== 'active') return { kind: 'paused' as const };
        const received = lead.receivedAt ? new Date(lead.receivedAt) : new Date();
        const receivedAt = Number.isNaN(received.getTime()) ? new Date() : received;
        const claim = await this.events.claim(tx, orgId, {
          sourceId,
          externalId: lead.externalId.slice(0, 255),
          isTest: opts.isTest === true,
          payload: lead,
          expiresAt: new Date(Date.now() + source.rawRetentionDays * MS_PER_DAY),
          receivedAt,
        });
        if (claim.kind === 'claimed') {
          await this.audit.record(tx, {
            module: LEAD_EVENTS,
            recordId: claim.row.id,
            action: 'insert',
          });
        }
        return { kind: 'claim' as const, source, claim };
      });
      if (claimed.kind === 'no_source')
        return { result: { status: 'failed', reason: 'source_not_found' } };
      if (claimed.kind === 'paused')
        return { result: { status: 'failed', reason: 'source_paused' } };
      const { source, claim } = claimed;
      if (claim.kind === 'repeat') {
        return {
          result: {
            status: 'duplicate',
            contactId: claim.row.contactId ?? undefined,
            dealId: claim.row.dealId ?? undefined,
          },
          eventId: claim.row.id,
        };
      }
      return this.run(orgId, source, claim.row, lead, opts);
    });
  }

  /**
   * Processes an event the caller holds: a new claim, or the retry of one stored lead after the admin fixed its mapping. The lead is the
   * stored payload when retrying, so the retry sees exactly what the sender sent.
   */
  async run(
    orgId: number,
    source: LeadSourceRow,
    event: LeadEventRow,
    lead: NormalisedLead,
    opts: ProcessOptions,
  ): Promise<ProcessOutcome> {
    const isTest = opts.isTest ?? event.isTest;
    let outcome: {
      result: LeadIngestResult;
      contactUuid?: string;
      defaults: LeadSourceDefaults;
      resolved: ResolvedLeadFields;
      created: boolean;
    };
    try {
      outcome = await this.db.txAs({ orgId, userId: actingUserId() }, (tx) =>
        this.writeOutcome(tx, orgId, source, event, lead, isTest),
      );
    } catch (err) {
      return this.fail(orgId, event, err);
    }
    if (outcome.result.status !== 'created' && outcome.result.status !== 'updated') {
      return { result: outcome.result, eventId: event.id };
    }

    const dealId = await this.maybeCreateDeal(orgId, event, outcome);
    return {
      result: { ...outcome.result, dealId: dealId ?? outcome.result.dealId },
      eventId: event.id,
    };
  }

  // --- the transaction that decides the outcome -------------------------------------------------------------------------------

  private async writeOutcome(
    tx: Tx,
    orgId: number,
    source: LeadSourceRow,
    event: LeadEventRow,
    lead: NormalisedLead,
    isTest: boolean,
  ): Promise<{
    result: LeadIngestResult;
    contactUuid?: string;
    defaults: LeadSourceDefaults;
    resolved: ResolvedLeadFields;
    created: boolean;
  }> {
    const defaults = defaultsOf(source);
    const fields = flattenInput(lead);
    const resolved = resolveLeadFields(
      { fields, raw: lead.raw, attribution: lead.attribution },
      source.mapping,
    );
    const phone = normaliseLeadPhone(resolved.phoneRaw, defaults.countryCode);
    const email = resolved.email;
    const label = platformLabel(source, defaults, resolved.attribution.platform);

    if (!phone && !email) {
      const reason = resolved.phoneRaw ? 'invalid_phone' : 'no_contact_point';
      return this.review(tx, orgId, source, event, reason, defaults, resolved);
    }

    const found = await this.resolveContact(tx, orgId, {
      phone,
      email,
      name: resolved.name,
      label,
      stage: await this.validStage(tx, orgId, defaults.lifecycleStage ?? undefined),
      isTest,
      lead: { source: source.name, sourceId: source.uuid, campaign: resolved.attribution.campaign },
    });
    if (found.kind === 'review') {
      return this.review(tx, orgId, source, event, found.reason, defaults, resolved);
    }

    const row = (await this.contactRepo.findById(tx, orgId, found.contactId))!;
    // A contact that already has an owner keeps them (and costs the rotation no turn); only an unowned one is assigned.
    const owner =
      row.ownerId === null
        ? await this.chooseOwner(tx, orgId, source, defaults)
        : (await this.sources.stampLastEvent(tx, orgId, source.id), null);
    const conflict = await this.fillContact(tx, orgId, row, {
      resolved,
      phone,
      email,
      label,
      owner: owner?.id ?? null,
      customTypes: await this.sources.contactFieldTypes(tx, orgId, Object.keys(resolved.custom)),
      created: found.created,
    });

    await this.applyTag(tx, orgId, found.contactId, defaults);
    await this.attributions.insert(tx, orgId, {
      contactId: found.contactId,
      leadEventId: event.id,
      sourceId: source.id,
      platform: label,
      sourceLabel: label,
      campaign: resolved.attribution.campaign,
      adset: resolved.attribution.adset,
      ad: resolved.attribution.ad,
      form: resolved.attribution.form,
      capturedAt: event.receivedAt,
    });

    const status = found.created ? 'created' : 'updated';
    const ownerUuid =
      row.ownerId === null ? (owner?.uuid ?? null) : await this.userUuid(tx, orgId, row.ownerId);
    const notify = await this.notifyTargets(tx, orgId, defaults, ownerUuid);
    await this.events.finish(tx, orgId, event.id, {
      status,
      reason: conflict ? 'identity_conflict' : null,
      contactId: found.contactId,
      dealId: event.dealId,
    });
    await this.audit.record(tx, {
      module: LEAD_EVENTS,
      recordId: event.id,
      action: 'update',
      delta: { status: { old: event.status, new: status } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'leads',
      aggregateId: event.id,
      eventType: found.created ? 'lead.created' : 'lead.updated',
      orgId,
      payload: {
        leadEventId: event.uuid,
        leadSourceId: source.uuid,
        sourceName: source.name,
        platform: label,
        contactId: found.uuid,
        contactName: row.name ?? resolved.name,
        ownerId: ownerUuid,
        notify,
        test: isTest,
      },
    });
    return {
      result: {
        status,
        contactId: found.contactId,
        reason: conflict ? 'identity_conflict' : undefined,
      },
      contactUuid: found.uuid,
      defaults,
      resolved,
      created: found.created,
    };
  }

  /** Stores the lead as `needs_review`: it is kept with its payload, shown in "Needs attention", and retried after a fix. */
  private async review(
    tx: Tx,
    orgId: number,
    source: LeadSourceRow,
    event: LeadEventRow,
    reason: 'plan_limit_reached' | 'invalid_phone' | 'no_contact_point',
    defaults: LeadSourceDefaults,
    resolved: ResolvedLeadFields,
  ) {
    await this.events.finish(tx, orgId, event.id, {
      status: 'needs_review',
      reason,
      error: REVIEW_TEXT[reason],
    });
    await this.audit.record(tx, {
      module: LEAD_EVENTS,
      recordId: event.id,
      action: 'update',
      delta: {
        status: { old: event.status, new: 'needs_review' },
        reason: { old: null, new: reason },
      },
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'leads',
      aggregateId: event.id,
      eventType: 'lead.needs_review',
      orgId,
      payload: { leadEventId: event.uuid, leadSourceId: source.uuid, reason, test: event.isTest },
    });
    return {
      result: { status: 'needs_review' as const, reason },
      defaults,
      resolved,
      created: false,
    };
  }

  /** An unexpected error: the outcome transaction already rolled back, so the event is marked failed in a transaction of its own. */
  private async fail(orgId: number, event: LeadEventRow, err: unknown): Promise<ProcessOutcome> {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof AppError ? err.code : 'INTERNAL';
    this.logger.error({ err, orgId, leadEvent: event.uuid }, 'lead processing failed');
    try {
      await this.db.txAs({ orgId, userId: actingUserId() }, async (tx) => {
        await this.events.finish(tx, orgId, event.id, {
          status: 'failed',
          reason: 'internal_error',
          error: `${code}: ${message}`.slice(0, 500),
        });
        await this.audit.record(tx, {
          module: LEAD_EVENTS,
          recordId: event.id,
          action: 'update',
          delta: { status: { old: event.status, new: 'failed' } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'leads',
          aggregateId: event.id,
          eventType: 'lead.failed',
          orgId,
          payload: { leadEventId: event.uuid, reason: 'internal_error', test: event.isTest },
        });
      });
    } catch (inner) {
      this.logger.error(
        { err: inner, orgId, leadEvent: event.uuid },
        'could not record a failed lead',
      );
    }
    return { result: { status: 'failed', reason: 'internal_error' }, eventId: event.id };
  }

  // --- contact -------------------------------------------------------------------------------------------------------------------

  /**
   * Identity-first dedupe, in the order `ContactsService.create` uses (email, then phone), then the stored normalised values (a contact
   * that predates identities), then `resolveOrCreateByIdentity` for a phone or an address nobody holds: it serialises two leads with the
   * same number and enforces the plan's contact cap.
   */
  private async resolveContact(
    tx: Tx,
    orgId: number,
    q: {
      phone: LeadPhone | null;
      email: string | null;
      name: string | null;
      label: string;
      stage: string | undefined;
      isTest: boolean;
      lead: { source: string; sourceId: string; campaign: string | null };
    },
  ): Promise<ContactOutcome> {
    const viaEmail = q.email
      ? await this.contactRepo.findByIdentity(tx, orgId, 'email', q.email)
      : undefined;
    const viaPhone = q.phone
      ? await this.contactRepo.findByIdentity(tx, orgId, 'phone', q.phone.e164)
      : undefined;
    let id = viaEmail ?? viaPhone;
    if (id === undefined && q.email) {
      const legacy = await tx.execute(
        sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND normalized_email = ${q.email} ORDER BY id LIMIT 1`,
      );
      const hit = legacy.rows[0] as { id: number | string } | undefined;
      if (hit) id = Number(hit.id);
    }
    if (id !== undefined) {
      const uuid = await this.contactUuid(tx, orgId, id);
      if (uuid) return { kind: 'ok', contactId: id, uuid, created: false };
    }

    const resolved = await this.contacts.resolveOrCreateByIdentity(tx, orgId, {
      kind: q.phone ? 'phone' : 'email',
      value: q.phone ? q.phone.e164 : q.email!,
      name: q.name,
      source: q.label,
      lifecycleStage: q.stage,
      quiet: q.isTest,
      eventPayload: {
        ...(q.email ? { email: q.email } : {}),
        leadSource: q.lead.source,
        leadSourceId: q.lead.sourceId,
        ...(q.lead.campaign ? { campaign: q.lead.campaign } : {}),
        origin: 'lead',
      },
    });
    switch (resolved.outcome) {
      case 'created':
      case 'found':
        return {
          kind: 'ok',
          contactId: resolved.contactId,
          uuid: resolved.uuid,
          created: resolved.outcome === 'created',
        };
      case 'quota_reached':
        return { kind: 'review', reason: 'plan_limit_reached' };
      case 'unusable':
        return { kind: 'review', reason: q.phone ? 'invalid_phone' : 'no_contact_point' };
    }
  }

  /**
   * What a lead adds to its contact. A contact the lead just created takes every value; one that already existed keeps everything a
   * person may have curated (a name, an email, a custom value, an owner) and only has its blanks filled, so a form that arrives with
   * less than the CRM already knows never makes the contact worse. Returns true when the phone or email belongs to ANOTHER contact (the
   * lead matched one contact by one identity and the other identity is somebody else's): nothing is stolen, the event says so.
   */
  private async fillContact(
    tx: Tx,
    orgId: number,
    row: NonNullable<Awaited<ReturnType<ContactsRepository['findById']>>>,
    v: {
      resolved: ResolvedLeadFields;
      phone: LeadPhone | null;
      email: string | null;
      label: string;
      owner: number | null;
      customTypes: Map<string, string>;
      created: boolean;
    },
  ): Promise<boolean> {
    const patch: Record<string, unknown> = {};
    const blank = (x: string | null | undefined): boolean =>
      x === null || x === undefined || x.trim() === '';
    let conflict = false;

    if (blank(row.name) && v.resolved.name) patch.name = v.resolved.name;
    if (blank(row.firstName) && v.resolved.firstName) patch.firstName = v.resolved.firstName;
    if (blank(row.lastName) && v.resolved.lastName) patch.lastName = v.resolved.lastName;
    if (blank(row.source)) patch.source = v.label;
    if (v.owner !== null && row.ownerId === null) patch.ownerId = v.owner;

    if (v.email) {
      const holder = await this.contactRepo.findByIdentity(tx, orgId, 'email', v.email);
      if (holder === undefined || holder === row.id) {
        await this.contactRepo.addIdentity(tx, orgId, row.id, 'email', v.email);
        if (blank(row.email)) patch.email = v.email;
      } else conflict = true;
    }
    if (v.phone) {
      const holder = await this.contactRepo.findByIdentity(tx, orgId, 'phone', v.phone.e164);
      if (holder === undefined || holder === row.id) {
        await this.contactRepo.addIdentity(tx, orgId, row.id, 'phone', v.phone.e164);
        if (blank(row.phone)) patch.phone = v.phone.e164;
      } else conflict = true;
    }

    const custom: Record<string, unknown> = {};
    for (const [key, text] of Object.entries(v.resolved.custom)) {
      const type = v.customTypes.get(key);
      if (!type) continue;
      const value = coerceCustomValue(type, text);
      if (value === undefined) continue;
      const have = row.data?.[key];
      if (have === undefined || have === null || have === '') custom[key] = value;
    }
    if (Object.keys(custom).length > 0) patch.data = { ...(row.data ?? {}), ...custom };

    if (Object.keys(patch).length === 0) return conflict;
    await this.contactRepo.updateFieldsById(tx, orgId, row.id, { ...patch, updatedBy: null });
    if (!v.created) {
      await this.audit.record(tx, {
        module: CONTACTS,
        recordId: row.id,
        action: 'update',
        delta: Object.fromEntries(
          Object.keys(patch)
            .filter((k) => k !== 'data')
            .map((k) => [
              k,
              { old: (row as unknown as Record<string, unknown>)[k] ?? null, new: patch[k] },
            ]),
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: CONTACTS,
        aggregateId: row.id,
        eventType: 'contact.updated',
        orgId,
        payload: { uuid: row.uuid, via: 'lead' },
      });
    }
    return conflict;
  }

  private async applyTag(tx: Tx, orgId: number, contactId: number, defaults: LeadSourceDefaults) {
    // Reference tagged every webhook lead "Lead" unless the hook said otherwise: an absent tag is that default, `null` is "no tag".
    const name = defaults.tag === undefined ? 'Lead' : defaults.tag;
    if (!name) return;
    let tag = await this.tags.findByName(tx, orgId, name);
    if (!tag) {
      if (await this.plan.tagCapReached(orgId, await this.tags.countAll(tx, orgId))) return;
      await this.tags.insertIfAbsent(tx, orgId, { name, color: '#2E7D32' });
      tag = await this.tags.findByName(tx, orgId, name);
    }
    if (tag) await this.tags.attach(tx, orgId, [contactId], [tag.id], null);
  }

  // --- owner -------------------------------------------------------------------------------------------------------------------

  /** The user a lead goes to under the source's rule, or null. Round robin consumes a turn only when a user can take it. */
  private async chooseOwner(
    tx: Tx,
    orgId: number,
    source: LeadSourceRow,
    defaults: LeadSourceDefaults,
  ): Promise<{ id: number; uuid: string } | null> {
    const rule = defaults.owner;
    const active =
      rule.mode === 'unassigned' || rule.userIds.length === 0
        ? []
        : await this.sources.activeUsers(tx, orgId, rule.userIds);
    // takeTurn also stamps the last event; the other branches stamp it themselves.
    if (rule.mode !== 'round_robin' || active.length === 0) {
      await this.sources.stampLastEvent(tx, orgId, source.id);
      return pickOwner(rule, active, 0).pick;
    }
    return pickOwner(rule, active, await this.sources.takeTurn(tx, orgId, source.id)).pick;
  }

  private async userUuid(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM users WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return (res.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
  }

  /** Who is told about the lead: its owner (when the rule says so) and the extra users named on the source. */
  private async notifyTargets(
    tx: Tx,
    orgId: number,
    defaults: LeadSourceDefaults,
    ownerUuid: string | null,
  ): Promise<string[]> {
    const wanted = new Set<string>(defaults.notify.userIds);
    if (defaults.notify.owner && ownerUuid) wanted.add(ownerUuid);
    return (await this.sources.activeUsers(tx, orgId, [...wanted])).map((u) => u.uuid);
  }

  // --- small reads -------------------------------------------------------------------------------------------------------------

  private async contactUuid(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return (res.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
  }

  /** The source's stage when it still exists and may be entered without a reason; else the workspace default (undefined). */
  private async validStage(
    tx: Tx,
    orgId: number,
    stage: string | undefined,
  ): Promise<string | undefined> {
    return stage && (await this.sources.stageUsable(tx, orgId, stage)) ? stage : undefined;
  }

  // --- deal --------------------------------------------------------------------------------------------------------------------

  /**
   * The optional deal (spec L-08). A transaction of its own (the deals service opens one), so it can fail without undoing the lead: the
   * event then says why there is no deal. A returning contact that already has an open deal does not get a second one.
   */
  private async maybeCreateDeal(
    orgId: number,
    event: LeadEventRow,
    outcome: {
      result: LeadIngestResult;
      contactUuid?: string;
      defaults: LeadSourceDefaults;
      resolved: ResolvedLeadFields;
      created: boolean;
    },
  ): Promise<number | undefined> {
    const rule = outcome.defaults.deal;
    if (!rule.enabled || !outcome.contactUuid || outcome.result.contactId === undefined)
      return undefined;
    const contactId = outcome.result.contactId;
    const note = async (dealId: number | null, text: string | null) =>
      this.db.txAs({ orgId, userId: actingUserId() }, (tx) =>
        this.events.setDeal(tx, orgId, event.id, dealId, text),
      );
    try {
      if (!(await this.plan.salesPipelineEnabled(orgId))) {
        await note(null, 'deal_skipped: the plan has no sales pipeline');
        return undefined;
      }
      if (!outcome.created) {
        const open = await this.db.txAs({ orgId, userId: actingUserId() }, (tx) =>
          tx.execute(
            sql`SELECT 1 FROM deals WHERE org_id = ${orgId} AND contact_id = ${contactId} AND status = 'open' LIMIT 1`,
          ),
        );
        if (open.rows.length > 0) return undefined;
      }
      const ownerUuid = await this.db.txAs({ orgId, userId: actingUserId() }, async (tx) => {
        const res = await tx.execute(sql`
          SELECT u.uuid FROM contacts c JOIN users u ON u.org_id = c.org_id AND u.id = c.owner_id
          WHERE c.org_id = ${orgId} AND c.id = ${contactId}`);
        return (res.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
      });
      const name = outcome.resolved.name ?? outcome.resolved.email ?? 'New lead';
      const deal = await this.deals.create(
        {
          title: renderDealTitle(
            rule.title,
            {
              name: outcome.resolved.name,
              source: outcome.resolved.attribution.platform ?? outcome.defaults.platform ?? null,
              campaign: outcome.resolved.attribution.campaign,
            },
            name,
          ),
          pipelineId: rule.pipelineId ?? undefined,
          stageId: rule.stageId ?? undefined,
          contactId: outcome.contactUuid,
          ownerId: ownerUuid,
        },
        'lead_ad',
      );
      const dealId = await this.db.txAs({ orgId, userId: actingUserId() }, async (tx) => {
        const res = await tx.execute(
          sql`SELECT id FROM deals WHERE org_id = ${orgId} AND uuid = ${deal.id}::uuid`,
        );
        const id = Number((res.rows[0] as { id: number | string }).id);
        await this.events.setDeal(tx, orgId, event.id, id, null);
        await this.audit.record(tx, {
          module: LEAD_EVENTS,
          recordId: event.id,
          action: 'update',
          delta: { dealId: { old: null, new: deal.id } },
        });
        return id;
      });
      return dealId;
    } catch (err) {
      const text =
        err instanceof AppError
          ? `deal_failed: ${err.code}`
          : `deal_failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.warn({ err, orgId, leadEvent: event.uuid }, 'lead deal not created');
      await note(null, text.slice(0, 500)).catch(() => undefined);
      return undefined;
    }
  }
}

const REVIEW_TEXT = {
  no_contact_point: 'The lead has neither a usable email address nor a phone number.',
  invalid_phone:
    'The phone number could not be read as one, and there is no email. Check the mapping or the default country code.',
  plan_limit_reached:
    "The workspace's plan has reached its contact limit. Upgrade the plan, then retry the lead.",
} as const;

/** The lead's `fields` as the pipeline reads them: a connector's own, plus what a webhook's raw body adds (never over a field it named). */
function flattenInput(lead: NormalisedLead): Record<string, string | number | boolean | null> {
  const base = { ...flattenPayload(lead.raw), ...lead.fields };
  return base;
}
