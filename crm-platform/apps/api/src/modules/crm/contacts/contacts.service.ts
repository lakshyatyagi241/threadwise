import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { ERROR_CODES, canonicalizePhone, composeDisplayName } from '@crm/contracts';
import type {
  ConsentProof,
  ConsentSource,
  IntakeChannel,
  AssigneeResponse,
  BulkResult,
  BulkUpdateContactsInput,
  ContactListResponse,
  ContactFilterValues,
  ContactResponse,
  ContactSendWindow,
  ContactSelectItem,
  ContactSelectQuery,
  CreateContactInput,
  FieldHistoryEntry,
  ListContactsQuery,
  ListFieldHistoryQuery,
  PageResponse,
  RecordScope,
  SetContactAssigneeInput,
  UpdateContactInput,
} from '@crm/contracts';
import { RequestContextStore, type RequestContext } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { DisplayIdService } from '../../../kernel/identifiers/display-id.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertCompanyReadable, companyLinkRefused } from '../companies/company-link';
import { countWithTimeout } from '../segments/segment-count';
import { contactConditions, contactScopeCondition, whereOf } from './contact-conditions';
import { stagesInUse, statusesInUse } from './contact-values-in-use';
import { resolveContactFilter } from './contact-filter.resolver';
import { stageEntryValues } from './contact-stage';
import { planStatus } from './contact-status-stage';
import { assertFormFieldLimits } from './form-field-limits';
import { applyPropertyPlan, planPropertyChanges } from './contact-property-values';
import {
  missingRequired,
  requiredPropertiesError,
  requiredScopeOfEdit,
  type RequiredRule,
} from './required-properties';
import {
  ConsentIntakeService,
  ContactConsentService,
  MinorDetectionService,
  hasProof,
  intakeEvidence,
  planIntakeGrants,
  type IntakePlan,
} from '../../contact-consent';
import { PersonalDataErasureService } from '../../privacy';
import { ContactQuotaService } from './contact-quota.service';
import { assertContactScope } from './contact-scope';
import { assertOwnerWithinScope } from '../owner-scope';
import { SendWindowService } from '../../compliance-center';
import { ContactTouchService } from '../lead-handling/contact-touch.service';
import { createMethodOfActor, type CreateMethod } from '../lead-handling/lead-handling-rules';
import { toContactResponse } from './contacts.mapper';
import { ContactsRepository, encodeSortCursor, type ContactRow } from './contacts.repository';

const MODULE_KEY = 'contacts';

/** The contact's own text columns a flow may set by key (the key is the contact form's and the run variable's; the value is the column). */
export const FLOW_CONTACT_COLUMNS: Readonly<Record<string, string>> = {
  name: 'name',
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  title: 'title',
  language: 'language',
  address: 'address',
};
const DISPLAY_PREFIX = 'CON';

/** The status column of each channel a consent can be granted on at intake. */
const STATUS_COLUMN = {
  whatsapp: 'whatsappSubscriptionStatus',
  sms: 'smsSubscriptionStatus',
  email: 'emailSubscriptionStatus',
} as const satisfies Record<IntakeChannel, string>;

/**
 * Who is agreeing, for the ledger event a contact write may leave behind (`create` and `update` take it as an optional last argument).
 * A staff session records `manual`, an API key `api`; a caller that stands for the person (a partner agent, a public lead submit) says
 * `api` and names itself in `evidence.reference`.
 */
export interface ContactConsentContext {
  source?: ConsentSource;
  evidence?: Record<string, string | undefined>;
  /**
   * A stable key for callers that send the same agreement again and again (a sheet re-sent by its add-on): the grant is written once.
   * Omitted, every write that carries a claim records its own event.
   */
  dedupeKey?: string;
}

/** Who set a contact's time zone (BL-193): an API key (or a caller that says `api`) or a person in the app. */
function timezoneSourceOf(
  ctx: { actorType?: string },
  via?: ContactConsentContext,
): 'staff' | 'api' {
  return via?.source === 'api' || ctx.actorType === 'api_key' ? 'api' : 'staff';
}

/** The statuses a write carries, by channel (undefined: not part of the write). */
function statusesOf(input: {
  whatsappSubscriptionStatus?: string | null;
  smsSubscriptionStatus?: string | null;
  emailSubscriptionStatus?: string | null;
}) {
  return {
    whatsapp: input.whatsappSubscriptionStatus,
    sms: input.smsSubscriptionStatus,
    email: input.emailSubscriptionStatus,
  };
}

/** What an inbound message knows about its sender (`ContactsService.resolveOrCreateByIdentity`). */
export interface ResolveContactInput {
  /**
   * `phone` and `email` are identities; `channel_uid` is a person a channel knows only by its own id (a Telegram user, a Facebook or
   * Instagram sender, a website widget visitor): `value` is that id and `channel` names the channel. Such a contact is unique per
   * (workspace, channel, id).
   */
  kind: 'phone' | 'email' | 'channel_uid';
  /** As the channel wrote it: a phone number in any format, an email address, or (`channel_uid`) the channel's own id. */
  value: string;
  /** `channel_uid` only: the channel the id belongs to (`telegram`, `facebook`, `instagram`, `chatbot_widget`). */
  channel?: string;
  /**
   * `channel_uid` only: what else the channel knows. With `matchPhoneFirst`, a contact that already holds this phone IS the person
   * (the widget's pre-chat form) and nothing new is made; otherwise the extras are stored on a contact created here.
   */
  phone?: string | null;
  email?: string | null;
  firstName?: string | null;
  matchPhoneFirst?: boolean;
  /** `channel_uid` only: the contact's note (`contacts.message`), such as "Source: Telegram DM". */
  message?: string;
  /** The sender's own name (WhatsApp's profile name), kept only when a contact is created. */
  name?: string | null;
  /** Where the contact came from (`contacts.source`). */
  source?: string;
  /**
   * A bulk import, not live engagement (WhatsApp Business app address-book sync): no `contact.created` event, so no flow enrolment
   * and no notification fires for each synced number; and a blank name on a contact that already exists is filled in (a name
   * somebody wrote is never replaced).
   */
  quiet?: boolean;
  /** The name a CREATED contact gets when `name` is empty (a placeholder for a bare number). Never written to an existing contact. */
  createdName?: string;
  /** The stage a created contact starts in, instead of the workspace default (a lead source's own stage). A lost stage is ignored. */
  lifecycleStage?: string;
  /**
   * Make a separate contact even though this identity already belongs to the contact with this internal id (BL-292, the duplicate leads
   * setting `create_new`). The identity stays with the original (it is unique per workspace), so the new contact carries the value on its
   * own record and inbound messages keep routing to the first one; a later "Remove duplicates" can merge them.
   */
  duplicateOf?: number;
  /** The owner of a created contact (an internal user id), for a writer that assigns on arrival (lead sources). */
  ownerId?: number | null;
  /** Extra keys of the `contact.created` payload (a lead's source and campaign), next to `via`. Never overrides the keys the event owns. */
  eventPayload?: Record<string, unknown>;
}

export type ResolvedContact =
  | { outcome: 'found' | 'created'; contactId: number; uuid: string }
  /** The plan's contact cap is reached: the caller carries on without a contact (an inbound message is never dropped). */
  | { outcome: 'quota_reached' }
  /** The value is not a usable phone number or address. */
  | { outcome: 'unusable' };

/**
 * Contacts — the reference implementation.
 *
 * The shape every other module follows:
 *   1. one transaction per operation, opened by DatabaseService.tx()
 *   2. the write, the audit row and the outbox event all inside it
 *   3. uuid -> internal id resolution at the edge, never deeper
 *   4. optimistic locking on update, 409 on a lost race
 */
/** A page of a list ordered by a column: the cursor carries the last row's sort value, not its creation time. */
function buildSortedPage(rows: ContactRow[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    page: {
      nextCursor: hasMore && last ? encodeSortCursor(last.sortKey ?? null, last.id) : null,
      hasMore,
      limit,
    },
  };
}

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly displayIds: DisplayIdService,
    private readonly rbac: RbacService,
    private readonly quota: ContactQuotaService,
    private readonly consent: ContactConsentService,
    private readonly intake: ConsentIntakeService,
    private readonly erasure: PersonalDataErasureService,
    private readonly sendWindow: SendWindowService,
    private readonly minors: MinorDetectionService,
    private readonly touch: ContactTouchService,
  ) {}

  /**
   * The clock marketing messages to this contact are read on and what the quiet hours say about it right now (BL-193): the contact's
   * stored zone and who set it, the zone the sender would really use, the next allowed send time when it would be held, and how many
   * messages already wait. Same record scope as reading the contact.
   */
  async sendWindowOf(uuid: string): Promise<ContactSendWindow> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Contact', uuid);
      const { scope } = this.rbac.can(ctx.grants!, 'record.contacts.read');
      await assertContactScope(tx, this.repo, ctx.orgId, scope, ctx.userId!, row);
      return this.sendWindow.contactWindow(ctx.orgId, row.id, { tx });
    });
  }

  async list(
    query: ListContactsQuery,
    scope: RecordScope,
    opts?: { canRevealPhone?: boolean },
  ): Promise<ContactListResponse> {
    const ctx = RequestContextStore.require();
    // `opts.canRevealPhone` lets a caller that is a different surface entirely (Developer REST
    // API v1: "a key sees the whole workspace", see its own read()) keep its pre-existing
    // behaviour instead of inheriting the Contacts-screen grant check below.
    const canRevealPhone =
      opts?.canRevealPhone ?? this.rbac.can(ctx.grants!, 'contacts.phone.reveal').allowed;

    return this.db.tx(async (tx) => {
      const resolution = await resolveContactFilter(tx, ctx.orgId, query);

      // A filter that names a uuid that does not exist (an owner, a group, a tag) must return
      // nothing, not "ignore the filter and return everything".
      if (resolution.empty) {
        return {
          data: [],
          page: { nextCursor: null, hasMore: false, limit: query.limit },
          ...(query.includeTotal ? { meta: { total: 0 } } : {}),
        };
      }
      const segment = resolution.segment;

      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
        sort: query.sort,
        filter: resolution.filter,
        scope,
        actorUserId: ctx.userId,
      });

      const { items, page } =
        query.sort === 'createdAt'
          ? buildPage(rows, query.limit)
          : buildSortedPage(rows, query.limit);

      const ids = items.map((i) => i.id);
      const groupChips = query.expand?.includes('groups')
        ? await this.repo.groupChips(tx, ctx.orgId, ids)
        : undefined;
      const tagChips = query.expand?.includes('tags')
        ? await this.repo.tagChips(tx, ctx.orgId, ids)
        : undefined;
      const data = items.map((row) =>
        toContactResponse(row, {
          groups: groupChips?.filter((c) => c.contactId === row.id),
          tags: tagChips?.filter((c) => c.contactId === row.id),
          canRevealPhone,
        }),
      );

      // A segment can be any rule over millions of rows: its total is counted under the 3 second ceiling.
      let approximate = false;
      let total: number | undefined;
      if (query.includeTotal && resolution.filter.segment) {
        const counted = await countWithTimeout(
          tx,
          whereOf(
            contactConditions(
              ctx.orgId,
              resolution.filter,
              contactScopeCondition(ctx.orgId, scope, ctx.userId),
            ),
          ),
        );
        total = counted.count;
        approximate = counted.approximate;
      } else if (query.includeTotal) {
        total = await this.repo.count(tx, ctx.orgId, resolution.filter, scope, ctx.userId);
      }
      return {
        data,
        page,
        ...(total !== undefined
          ? { meta: { total, ...(approximate ? { approximate } : {}) } }
          : {}),
        ...(segment ? { segment } : {}),
      };
    });
  }

  /** The stat tiles and sidebar counts: workspace-wide, inside the caller's record scope. */
  async stats(scope: RecordScope) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const s = await this.repo.stats(tx, ctx.orgId, scope, ctx.userId);
      return { ...s, grouped: s.total - s.noGroup };
    });
  }

  async getByUuid(uuid: string): Promise<ContactResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Contact', uuid);
      const { scope } = this.rbac.can(ctx.grants!, 'record.contacts.read');
      await assertContactScope(tx, this.repo, ctx.orgId, scope, ctx.userId!, row);
      // Restricted processing (BL-295): opening a contact under a legal hold is allowed (the business keeps serving the customer), and is
      // logged. The response is the same for everyone; whether a hold exists is shown only to readers of the register.
      const held = await tx.execute(
        sql`SELECT is_subject_held(${ctx.orgId}::bigint, 'contact', ${row.id}::bigint) AS held`,
      );
      if ((held.rows[0] as { held: boolean }).held === true) {
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: row.id,
          action: 'read',
          delta: { legalHold: { old: null, new: true } },
        });
      }
      const canRevealPhone = this.rbac.can(ctx.grants!, 'contacts.phone.reveal').allowed;
      return toContactResponse(row, { canRevealPhone });
    });
  }

  private async lockIdentities(
    tx: Tx,
    orgId: number,
    email: string | undefined,
    phone: string | undefined,
  ): Promise<void> {
    const keys = [
      email ? `email:${email.trim().toLowerCase()}` : null,
      phone ? `phone:${phone}` : null,
    ]
      .filter((k): k is string => k !== null)
      .sort();
    for (const k of keys) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`contact-identity:${orgId}:${k}`}, 0))`,
      );
    }
  }

  async create(input: CreateContactInput, via?: ContactConsentContext): Promise<ContactResponse> {
    return (await this.createOrMatch(input, via)).contact;
  }

  /**
   * `create`, saying whether a contact was made or an existing one (same email or phone) was returned. A caller that reports "created"
   * (an import, the Sheets add-on) needs the difference; two requests for one new person at once make one contact, and only one of them
   * created it.
   */
  async createOrMatch(
    input: CreateContactInput,
    via?: ContactConsentContext,
    /** How the contact came to be, when the actor does not say it (the Sheets add-on is an import): see the uncontacted settings. */
    opts: { createdVia?: CreateMethod } = {},
  ): Promise<{ contact: ContactResponse; created: boolean }> {
    const ctx = RequestContextStore.require();
    // A worker/system actor (the inbound-message pipeline below) carries no grants at all and is
    // never the one a masking rule is meant to restrict — only an HTTP request from a staff user
    // goes through the permission guard that populates `ctx.grants`, same convention as the
    // scope fallback a few methods down.
    const canRevealPhone = ctx.grants
      ? this.rbac.can(ctx.grants, 'contacts.phone.reveal').allowed
      : true;

    // One canonicaliser for create, import and dedupe (TW-CON-013). The contract already insists
    // on E.164, so this normally changes nothing; it is what keeps the identity key identical to
    // the one the importer writes for the same number.
    const phone = input.phone
      ? (canonicalizePhone({ number: input.phone })?.e164 ?? input.phone)
      : undefined;

    // Consent at intake (spec privacy-and-data-governance 4.3.2): a status set to `subscribed`, or a consent block, is a claim that the
    // person agreed. It needs proof (422 without), and it writes a ledger grant; the status alone never grants anything.
    const plan = planIntakeGrants({
      given: statusesOf(input),
      proof: input.consent,
      reachable: { phone: Boolean(phone), email: Boolean(input.email) },
    });
    this.assertIntakeAllowed(plan, input.consent, input.isUnsubscribed === true);

    return this.db.tx(async (tx) => {
      // Serialise creates of the same person: the identity lookup below and the insert are separate statements, so two requests for one
      // new email or phone (a sheet row sent twice, a form and a flow at once) would both find nobody and both insert. A transaction-scoped
      // advisory lock keyed on org and normalised identity makes the second wait for the first to commit, then find it. Locks are taken in
      // sorted order so two creates sharing one identity cannot deadlock; they are released at commit or rollback.
      await this.lockIdentities(tx, ctx.orgId, input.email, phone);
      // Omitted: the creator (Reference stamped `user_id` with the caller). `null`: nobody, which a caller whose
      // record scope is own/team is refused below (the contact would vanish from their own list).
      const ownerId =
        input.ownerId === null
          ? null
          : input.ownerId
            ? await this.requireUser(tx, ctx.orgId, input.ownerId)
            : ctx.userId;
      await this.assertOwnerAllowed(tx, 'record.contacts.create', ownerId ?? null);
      const companyId = input.companyId
        ? await this.requireCompany(tx, ctx.orgId, input.companyId)
        : null;

      // Identity-first dedup: if this email or phone already belongs to a
      // contact in this org, that contact IS this person. Creating a second
      // row would fork their timeline across channels, which is precisely
      // what contact_identities exists to prevent.
      const existingId =
        (input.email
          ? await this.repo.findByIdentity(tx, ctx.orgId, 'email', input.email)
          : undefined) ??
        (phone ? await this.repo.findByIdentity(tx, ctx.orgId, 'phone', phone) : undefined);

      if (existingId !== undefined) {
        const existing = await this.repo.findById(tx, ctx.orgId, existingId);
        if (existing) {
          this.logger.log(
            { orgId: ctx.orgId, contactId: existingId },
            'contact create matched an existing identity — returning the existing contact',
          );
          // The same person agreeing again is still an agreement: the grant lands on the contact they already are.
          const regranted = await this.grantOnMatch(tx, ctx, existing, input, via);
          return {
            // This can return an EXISTING contact matched by email alone — its phone may be
            // something the caller never typed, so it goes through the same grant check as
            // list/detail rather than being treated as "the caller already knows this".
            contact: toContactResponse(
              regranted
                ? ((await this.repo.findById(tx, ctx.orgId, existing.id)) ?? existing)
                : existing,
              { canRevealPhone },
            ),
            created: false,
          };
        }
      }

      assertFormFieldLimits(input.customFields);
      await this.assertPropertiesWritable(tx, ctx.orgId, input.customFields, {});
      // Properties the workspace marked required (Contact properties screen) are part of the contract of a create.
      await this.assertRequiredProperties(tx, ctx.orgId, input.customFields);

      // Plan cap (TW-CON-026): every way of adding a contact counts, not only the UI's.
      await this.quota.assertCanAddOne(tx, ctx.orgId);

      // No stage chosen: the workspace's default stage (Contact stages screen), else the column default.
      const stage =
        input.lifecycleStage ??
        (await this.repo.defaultOptionValue(tx, ctx.orgId, 'lifecycle_stage'));
      // A contact created straight into a won or lost stage is stamped, and a lost one needs its reason.
      const stageValues = stage
        ? stageEntryValues({
            flags: await this.repo.stageFlags(tx, ctx.orgId, stage),
            current: { wonAt: null, lostAt: null, lostReason: null, otherLostReason: null },
            lostReason: input.lostReason,
            otherLostReason: input.otherLostReason,
            now: new Date(),
          })
        : {};

      // The status must belong to the stage the contact starts in; none given = the stage's default status, if it has one.
      const startStage = stage ?? 'new';
      const statusCtx = await this.repo.statusContext(tx, ctx.orgId);
      const statusPlan = planStatus({
        scope: statusCtx.scope,
        stage: startStage,
        stageLabel: statusCtx.stageLabels.get(startStage) ?? null,
        stageChanged: true,
        current: null,
        requested: input.status,
      });

      const displayId = await this.displayIds.next(tx, ctx.orgId, MODULE_KEY, DISPLAY_PREFIX);

      const created = await this.repo.insert(tx, ctx.orgId, {
        // The display name is the typed name, else first + last. Never the title (TW-CON-012).
        name: composeDisplayName({
          name: input.name,
          firstName: input.firstName,
          lastName: input.lastName,
        }),
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone,
        companyId,
        ownerId,
        lifecycleStage: stage,
        lostReason: input.lostReason,
        otherLostReason: input.otherLostReason,
        wonAt: (stageValues.wonAt as Date | null | undefined) ?? null,
        lostAt: (stageValues.lostAt as Date | null | undefined) ?? null,
        status: statusPlan.status ?? undefined,
        leadScore: input.leadScore,
        whatsappSubscriptionStatus:
          input.whatsappSubscriptionStatus ??
          (plan.fillStatus.includes('whatsapp') ? 'subscribed' : undefined),
        smsSubscriptionStatus:
          input.smsSubscriptionStatus ??
          (plan.fillStatus.includes('sms') ? 'subscribed' : undefined),
        emailSubscriptionStatus:
          input.emailSubscriptionStatus ??
          (plan.fillStatus.includes('email') ? 'subscribed' : undefined),
        emailConfirmed: input.emailConfirmed,
        faxNumber: input.faxNumber,
        dateOfBirth: input.dateOfBirth,
        source: input.source,
        timezone: input.timezone,
        timezoneSource: timezoneSourceOf(ctx, via),
        isUnsubscribed: input.isUnsubscribed === true,
        unsubscribedAt: input.isUnsubscribed === true ? new Date() : null,
        data: input.customFields,
        displayId,
        createdBy: ctx.userId,
      });

      if (input.email) {
        await this.repo.addIdentity(tx, ctx.orgId, created.id, 'email', input.email);
      }
      if (phone) {
        await this.repo.addIdentity(tx, ctx.orgId, created.id, 'phone', phone);
      }

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: created.id,
        action: 'insert',
      });
      // Start uncontacted when the workspace says contacts created this way do (BL-290). Off by default: no write.
      const method = opts.createdVia ?? createMethodOfActor(ctx.actorType);
      if (method) await this.touch.markNew(tx, ctx.orgId, created.id, method);

      // A date of birth that makes the contact a minor sets the flag in the same transaction (BL-217).
      if (input.dateOfBirth) {
        await this.minors.evaluateInTx(tx, ctx.orgId, created.id, new Date(), { dobChanged: true });
      }
      // A contact created already opted out leaves its proof in the consent ledger (it is never invented for the other case).
      if (input.isUnsubscribed === true) {
        await this.consent.recordInTx(tx, ctx.orgId, {
          contactId: created.id,
          channel: 'whatsapp',
          action: 'withdrawn',
          source: ctx.actorType === 'api_key' ? 'api' : 'manual',
          actorUserId: ctx.userId,
          note: 'Created as unsubscribed',
          idempotencyKey: `create:${created.uuid}`,
        });
      }
      if (plan.grant.length > 0) {
        await this.intake.grant(tx, ctx.orgId, {
          contactId: created.id,
          channels: plan.grant,
          source: this.grantSource(ctx, via),
          proof: input.consent,
          evidence: via?.evidence,
          actorUserId: ctx.userId,
          keyBase: via?.dedupeKey ?? `create:${created.uuid}:grant`,
        });
      }

      // Same transaction as the insert — see OutboxService for why that is
      // not negotiable.
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact.created',
        payload: { uuid: created.uuid, displayId, email: input.email, phone },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return { contact: toContactResponse(row!, { canRevealPhone }), created: true };
    });
  }

  /**
   * "Whose message is this": the contact an identity belongs to, created when there is none. For the inbound pipeline of the
   * inbox, which runs this inside its own transaction (`tx`), as a system actor, once per new conversation.
   *
   * The same rules as `create`, because the inbox must not fork a person's timeline: the phone goes through the one canonicaliser
   * and is looked up by identity first, then by the stored number (a contact that predates identities is healed with one); the
   * plan's contact cap is enforced (`quota_reached`, no contact, never an exception: the message must still arrive); a created
   * contact gets the workspace's default stage and status, an identity row, an audit row and `contact.created` in the same
   * transaction. It does not demand the workspace's required custom properties: nobody is there to fill them in (Reference's
   * auto-capture skipped them too). An advisory lock serialises two messages from the same new number.
   */
  async resolveOrCreateByIdentity(
    tx: Tx,
    orgId: number,
    input: ResolveContactInput,
  ): Promise<ResolvedContact> {
    // The audit row names the context's workspace and actor. A worker (a channel webhook, a store import) has none of its own: it acts
    // as the system actor of THIS workspace; a request of the same workspace keeps its own actor.
    const current = RequestContextStore.peek();
    if (current && current.orgId === orgId) return this.resolveInContext(tx, orgId, input);
    return RequestContextStore.run(
      {
        requestId: `resolve-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.resolveInContext(tx, orgId, input),
    );
  }

  /**
   * `resolveOrCreateByIdentity` for many inputs, in the order given. A phone number or email that already belongs to a contact is answered
   * from two queries for the whole list (the identity and its contact), exactly as the single call answers it; every other input (new,
   * healed from a stored number, over the plan cap, unusable, or a channel id) goes through the single call unchanged, so locking, quota,
   * default stage, audit and outbox behave as before. An input repeating an earlier one that was created in this same call is resolved
   * by the single call too, so it finds the contact just made.
   */
  async resolveManyByIdentity(
    tx: Tx,
    orgId: number,
    inputs: readonly ResolveContactInput[],
  ): Promise<ResolvedContact[]> {
    const keyOf = (
      input: ResolveContactInput,
    ): { kind: 'email' | 'phone'; value: string } | null => {
      if (input.kind === 'phone') {
        const e164 = canonicalizePhone({ number: input.value })?.e164;
        return e164 ? { kind: 'phone', value: e164 } : null;
      }
      if (input.kind === 'email') {
        const value = input.value.trim().toLowerCase();
        return value ? { kind: 'email', value } : null;
      }
      return null;
    };
    const keys = inputs.map(keyOf);
    const known = await this.repo.contactsByIdentities(
      tx,
      orgId,
      keys.filter((k): k is { kind: 'email' | 'phone'; value: string } => k !== null),
    );
    const out: ResolvedContact[] = [];
    for (const [i, input] of inputs.entries()) {
      const key = keys[i];
      const hit = key ? known.get(`${key.kind}|${key.value}`) : undefined;
      if (hit) {
        if (input.quiet) await this.fillBlankName(tx, orgId, hit.id, input.name);
        out.push({ outcome: 'found', contactId: hit.id, uuid: hit.uuid });
      } else {
        out.push(await this.resolveOrCreateByIdentity(tx, orgId, input));
      }
    }
    return out;
  }

  private async resolveInContext(
    tx: Tx,
    orgId: number,
    input: ResolveContactInput,
  ): Promise<ResolvedContact> {
    if (input.kind === 'channel_uid') return this.resolveByChannelUid(tx, orgId, input);
    const phone = input.kind === 'phone' ? canonicalizePhone({ number: input.value }) : null;
    const value = input.kind === 'phone' ? phone?.e164 : input.value.trim().toLowerCase();
    if (!value || (input.kind === 'phone' && !phone)) return { outcome: 'unusable' };

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`contact-identity:${orgId}:${input.kind}:${value}`}, 0))`,
    );

    const viaIdentity = input.duplicateOf
      ? undefined
      : await this.repo.findByIdentity(tx, orgId, input.kind, value);
    if (viaIdentity !== undefined) {
      const uuid = await this.uuidOf(tx, orgId, viaIdentity);
      if (uuid) {
        if (input.quiet) await this.fillBlankName(tx, orgId, viaIdentity, input.name);
        return { outcome: 'found', contactId: viaIdentity, uuid };
      }
    }

    const stored = input.duplicateOf
      ? { rows: [] }
      : await tx.execute(
          input.kind === 'phone'
            ? sql`SELECT id, uuid FROM contacts
              WHERE org_id = ${orgId} AND normalized_phone IN (${value}, ${phone!.digits})
              ORDER BY id LIMIT 1`
            : sql`SELECT id, uuid FROM contacts
              WHERE org_id = ${orgId} AND normalized_email = ${value}
              ORDER BY id LIMIT 1`,
        );
    const known = stored.rows[0] as { id: number | string; uuid: string } | undefined;
    if (known) {
      await this.repo.addIdentity(tx, orgId, Number(known.id), input.kind, value);
      if (input.quiet) await this.fillBlankName(tx, orgId, Number(known.id), input.name);
      return { outcome: 'found', contactId: Number(known.id), uuid: known.uuid };
    }

    try {
      await this.quota.assertCanAddOne(tx, orgId);
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.PLAN_LIMIT_REACHED) {
        return { outcome: 'quota_reached' };
      }
      throw err;
    }

    // The workspace's default stage, unless it is a lost stage (those demand a reason, and nobody is here to give one).
    let stage =
      input.lifecycleStage ?? (await this.repo.defaultOptionValue(tx, orgId, 'lifecycle_stage'));
    const flags = stage ? await this.repo.stageFlags(tx, orgId, stage) : null;
    if (flags?.isLost) stage = undefined;
    const stageValues =
      stage && flags
        ? stageEntryValues({
            flags,
            current: { wonAt: null, lostAt: null, lostReason: null, otherLostReason: null },
            now: new Date(),
          })
        : {};
    const statusCtx = await this.repo.statusContext(tx, orgId);
    const statusPlan = planStatus({
      scope: statusCtx.scope,
      stage: stage ?? 'new',
      stageLabel: statusCtx.stageLabels.get(stage ?? 'new') ?? null,
      stageChanged: true,
      current: null,
      requested: undefined,
    });

    const displayId = await this.displayIds.next(tx, orgId, MODULE_KEY, DISPLAY_PREFIX);
    const created = await this.repo.insert(tx, orgId, {
      name: input.name?.trim() || input.createdName?.trim() || null,
      email: input.kind === 'email' ? value : undefined,
      phone: input.kind === 'phone' ? value : undefined,
      lifecycleStage: stage ?? undefined,
      wonAt: (stageValues.wonAt as Date | null | undefined) ?? null,
      lostAt: (stageValues.lostAt as Date | null | undefined) ?? null,
      status: statusPlan.status ?? undefined,
      source: input.source ?? null,
      ownerId: input.ownerId ?? null,
      data: {},
      displayId,
      createdBy: null,
    });
    // A separate contact takes the identity only when nobody holds it (the original does, by definition).
    if (
      !input.duplicateOf ||
      (await this.repo.findByIdentity(tx, orgId, input.kind, value)) === undefined
    ) {
      await this.repo.addIdentity(tx, orgId, created.id, input.kind, value);
    }
    await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
    // A lead source or a form made the contact: start it uncontacted when the workspace says so (BL-290). A test lead never is.
    const origin = input.eventPayload?.origin;
    if (!input.quiet && (origin === 'lead' || origin === 'form')) {
      await this.touch.markNew(tx, orgId, created.id, 'lead_source');
    }
    if (!input.quiet) {
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact.created',
        payload: {
          ...input.eventPayload,
          uuid: created.uuid,
          displayId,
          ...(input.kind === 'email' ? { email: value } : { phone: value }),
          via: input.source ?? 'inbound',
        },
        orgId,
      });
    }
    return { outcome: 'created', contactId: created.id, uuid: created.uuid };
  }

  /**
   * The flow "Ask for file / image" node's "save the response as property": writes one custom property value of the contact the run
   * belongs to (the file link). Only an active contact property of this workspace can be written, so a key typed by hand that names
   * nothing is refused (`false`). No `contact.updated` event: a flow that fills in its own contact must not start flows of its own.
   * Exception: a built-in contact column (`email`, `name`, ...) is written by `setFieldFromFlow`, the same path as the "Update contact
   * field" step, so "also save the answer on the contact property" works for them. That path emits `contact.updated` with `via: 'flow'`,
   * which flow triggers skip and webhooks receive.
   */
  async setPropertyFromFlow(
    orgId: number,
    contactId: number,
    key: string,
    value: string,
  ): Promise<boolean> {
    const clean = key.trim();
    if (clean === '') return false;
    if (Object.hasOwn(FLOW_CONTACT_COLUMNS, clean)) {
      return (await this.setFieldFromFlow(orgId, contactId, clean, value)) !== null;
    }
    return this.db.txAs({ orgId }, async (tx) => {
      const field = await tx.execute(
        sql`SELECT 1 FROM fields WHERE org_id = ${orgId} AND module_key = ${MODULE_KEY} AND key = ${clean} AND is_active = true`,
      );
      if (field.rows.length === 0) return false;
      const row = await this.repo.findById(tx, orgId, contactId);
      if (!row) return false;
      const done = await this.repo.updateFieldsById(tx, orgId, contactId, {
        data: { ...(row.data ?? {}), [clean]: value },
      });
      if (done) {
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: contactId,
          action: 'update',
          delta: { [clean]: { old: (row.data ?? {})[clean] ?? null, new: value } },
        });
      }
      return done;
    });
  }

  /**
   * The flow "Update contact field" step: one field of the contact the run belongs to. A field is either one of the contact's own text
   * columns (`FLOW_CONTACT_COLUMNS`) or an active custom property of this workspace by key; anything else is refused (`false`), so a
   * key typed by hand cannot write where it should not (the phone and the dedupe keys are never writable here). A blank value clears
   * a column except the name. `contact.updated` is emitted with `via: 'flow'` so webhooks hear it and the flow triggers skip it.
   * Returns the value as stored, or null when nothing could be written.
   */
  async setFieldFromFlow(
    orgId: number,
    contactId: number,
    key: string,
    value: string,
  ): Promise<{ stored: string } | null> {
    const clean = key.trim();
    if (clean === '') return null;
    const column = FLOW_CONTACT_COLUMNS[clean];
    return this.db.txAs({ orgId }, async (tx) => {
      const found = await tx.execute(
        sql`SELECT uuid, ${sql.raw(column ?? 'name')} AS current, data FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
      );
      const row = found.rows[0] as
        { uuid: string; current: string | null; data: Record<string, unknown> | null } | undefined;
      if (!row) return null;
      let stored = value.trim();
      let delta: Record<string, { old: unknown; new: unknown }>;
      if (column) {
        if (clean === 'name' && stored === '') return null;
        if (clean === 'email') stored = stored.toLowerCase();
        const next = stored === '' ? null : stored;
        await tx.execute(
          sql`UPDATE contacts SET ${sql.raw(column)} = ${next} WHERE org_id = ${orgId} AND id = ${contactId}`,
        );
        delta = { [clean]: { old: row.current ?? null, new: next } };
      } else {
        const field = await tx.execute(
          sql`SELECT 1 FROM fields WHERE org_id = ${orgId} AND module_key = ${MODULE_KEY} AND key = ${clean} AND is_active = true`,
        );
        if (field.rows.length === 0) return null;
        const done = await this.repo.updateFieldsById(tx, orgId, contactId, {
          data: { ...(row.data ?? {}), [clean]: stored },
        });
        if (!done) return null;
        delta = { [clean]: { old: (row.data ?? {})[clean] ?? null, new: stored } };
      }
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: contactId,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: MODULE_KEY,
        aggregateId: contactId,
        eventType: 'contact.updated',
        payload: { uuid: row.uuid, via: 'flow', fieldKeys: [clean] },
      });
      return { stored };
    });
  }

  /**
   * An automated intake path (not a staff request) already decided the person agreed: a WhatsApp Form field mapped to a consent
   * privacy key today (TW-WFL net addition), the same role form-submit's own private `subscribe`/`recordServiceAgreement` play for
   * web forms. `marketing` goes through `ConsentIntakeService` (the canonical intake-grant door) and marks the channel subscribed
   * if its status was blank, never over an existing one, including unsubscribed; `utility` writes the ledger directly (never a
   * marketing grant, changes no subscription label, announces no opt-in), matching `recordServiceAgreement`'s own rule. No RBAC
   * check: the caller already is the automated system that decided the grant is real. Returns whether anything was written.
   */
  async grantFromIntake(
    orgId: number,
    contactId: number,
    input: {
      channel: IntakeChannel;
      purpose: 'marketing' | 'utility';
      source: ConsentSource;
      text?: string;
      evidence?: Record<string, string | null | undefined>;
      idempotencyKey: string;
    },
  ): Promise<boolean> {
    return this.db.txAs({ orgId }, async (tx) => {
      const found = await tx.execute(
        sql`SELECT uuid FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
      );
      const row = found.rows[0] as { uuid: string } | undefined;
      if (!row) return false;

      if (input.purpose === 'utility') {
        const out = await this.consent.recordInTx(tx, orgId, {
          contactId,
          channel: input.channel,
          purpose: 'utility',
          action: 'granted',
          source: input.source,
          evidence: input.evidence,
          note: input.text,
          idempotencyKey: input.idempotencyKey,
          respectWithdrawn: true,
        });
        return out.recorded;
      }

      const recorded = await this.intake.grant(tx, orgId, {
        contactId,
        channels: [input.channel],
        source: input.source,
        proof: input.text ? { text: input.text } : undefined,
        evidence: input.evidence,
        keyBase: input.idempotencyKey,
      });
      if (recorded.length === 0) return false;
      const column = STATUS_COLUMN[input.channel];
      const existing = await tx.execute(
        sql`SELECT ${sql.raw(column)} AS status FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
      );
      const status = (existing.rows[0] as { status: string | null } | undefined)?.status;
      if ((status ?? '').trim()) return true;
      await tx.execute(
        sql`UPDATE contacts SET ${sql.raw(column)} = 'subscribed' WHERE org_id = ${orgId} AND id = ${contactId}`,
      );
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: contactId,
        action: 'update',
        delta: { [column]: { old: null, new: 'subscribed' } },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: MODULE_KEY,
        aggregateId: contactId,
        eventType: 'contact.opt_in',
        payload: { contactId: row.uuid, optedIn: true, action: 'subscribed', source: input.source },
      });
      return true;
    });
  }

  /** One field of a contact as text, for the flow triggers and conditions: an own column or a custom property; null when it is blank. */
  /**
   * A stage change made by the system, not by a person: the guarded automatic mode of the growth pilot, and its undo. The edit's own
   * rules hold (the won stamp, the status kept valid for the stage, audit, the stage-changed event), with two refusals: a contact that
   * is no longer in `expectFrom` (a person moved it first) and a lost stage (it needs a reason a person gives). Returns whether it moved.
   */
  async changeStageAsSystem(
    orgId: number,
    contactId: number,
    args: { expectFrom: string; to: string },
  ): Promise<boolean> {
    return this.db.txAs({ orgId }, async (tx) => {
      const existing = await this.repo.findById(tx, orgId, contactId);
      if (
        !existing ||
        existing.lifecycleStage !== args.expectFrom ||
        args.to === existing.lifecycleStage
      ) {
        return false;
      }
      const flags = await this.repo.stageFlags(tx, orgId, args.to);
      if (flags.isLost) return false;
      const now = new Date();
      const values: Record<string, unknown> = {
        lifecycleStage: args.to,
        lifecycleStageDate: now,
        previousLifecycleStage: existing.lifecycleStage,
        previousLifecycleStageDate: existing.lifecycleStageDate,
        ...stageEntryValues({ flags, current: existing, now }),
      };
      const statusCtx = await this.repo.statusContext(tx, orgId);
      const plan = planStatus({
        scope: statusCtx.scope,
        stage: args.to,
        stageLabel: statusCtx.stageLabels.get(args.to) ?? null,
        stageChanged: true,
        current: existing.status,
        requested: undefined,
      });
      if (plan.status !== undefined) values.status = plan.status;
      const updated = await this.repo.updateWithVersion(
        tx,
        orgId,
        existing.id,
        existing.rowVersion,
        values,
      );
      if (!updated) return false;
      const after = await this.repo.findById(tx, orgId, existing.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          existing as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
        ),
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact.stage_changed',
        payload: {
          uuid: existing.uuid,
          previousStage: existing.lifecycleStage,
          stage: args.to,
          via: 'growth',
        },
      });
      return true;
    });
  }

  async readFieldForFlow(orgId: number, contactId: number, key: string): Promise<string | null> {
    const clean = key.trim();
    if (clean === '') return null;
    return this.db.txAs({ orgId }, async (tx) => {
      const column = FLOW_CONTACT_COLUMNS[clean];
      const res = await tx.execute(
        column
          ? sql`SELECT ${sql.raw(column)}::text AS v FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`
          : sql`SELECT data ->> ${clean} AS v FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
      );
      const v = (res.rows[0] as { v: string | null } | undefined)?.v;
      return v === null || v === undefined || v.trim() === '' ? null : v;
    });
  }

  /**
   * `resolveOrCreateByIdentity` for a person a channel knows only by its own id. The same rules as the phone and email path: one lookup
   * under an advisory lock (two messages from one new sender make one contact), the plan's contact cap (`quota_reached`, never an
   * exception: the message must still arrive), the workspace's default stage and status, an identity row for any phone or address the
   * channel gave, and an audit row. It is quiet: no `contact.created` event, as the raw inserts it replaces never announced one. A blank
   * name on an existing contact is filled in; a curated one is never replaced. Consent: none is granted, ever.
   */
  private async resolveByChannelUid(
    tx: Tx,
    orgId: number,
    input: ResolveContactInput,
  ): Promise<ResolvedContact> {
    const channel = input.channel?.trim();
    const uid = input.value.trim();
    if (!channel || uid === '') return { outcome: 'unusable' };

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`contact-channel:${orgId}:${channel}:${uid}`}, 0))`,
    );

    const typedPhone = input.phone?.trim() ? input.phone.trim() : null;
    const phone = typedPhone
      ? (canonicalizePhone({ number: typedPhone })?.e164 ?? typedPhone)
      : null;
    const email = input.email?.trim() ? input.email.trim().toLowerCase() : null;

    if (phone && input.matchPhoneFirst) {
      const digits = phone.replace(/[^0-9]/g, '');
      const hit = await tx.execute(sql`
        SELECT id, uuid FROM contacts
        WHERE org_id = ${orgId} AND regexp_replace(coalesce(normalized_phone, ''), '[^0-9]', '', 'g') = ${digits}
        ORDER BY id LIMIT 1`);
      const row = hit.rows[0] as { id: number | string; uuid: string } | undefined;
      if (row) return { outcome: 'found', contactId: Number(row.id), uuid: row.uuid };
    }

    const keyed = await tx.execute(
      sql`SELECT id, uuid FROM contacts WHERE org_id = ${orgId} AND channel = ${channel} AND channel_uid = ${uid}`,
    );
    const known = keyed.rows[0] as { id: number | string; uuid: string } | undefined;
    if (known) {
      await this.fillBlankName(tx, orgId, Number(known.id), input.name);
      return { outcome: 'found', contactId: Number(known.id), uuid: known.uuid };
    }

    try {
      await this.quota.assertCanAddOne(tx, orgId);
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.PLAN_LIMIT_REACHED) {
        return { outcome: 'quota_reached' };
      }
      throw err;
    }

    let stage =
      input.lifecycleStage ?? (await this.repo.defaultOptionValue(tx, orgId, 'lifecycle_stage'));
    const flags = stage ? await this.repo.stageFlags(tx, orgId, stage) : null;
    if (flags?.isLost) stage = undefined;
    const stageValues =
      stage && flags
        ? stageEntryValues({
            flags,
            current: { wonAt: null, lostAt: null, lostReason: null, otherLostReason: null },
            now: new Date(),
          })
        : {};
    const statusCtx = await this.repo.statusContext(tx, orgId);
    const statusPlan = planStatus({
      scope: statusCtx.scope,
      stage: stage ?? 'new',
      stageLabel: statusCtx.stageLabels.get(stage ?? 'new') ?? null,
      stageChanged: true,
      current: null,
      requested: undefined,
    });
    const displayId = await this.displayIds.next(tx, orgId, MODULE_KEY, DISPLAY_PREFIX);
    const created = await this.repo.insert(tx, orgId, {
      name: input.name?.trim() || null,
      firstName: input.firstName?.trim() || null,
      email,
      phone,
      lifecycleStage: stage ?? undefined,
      wonAt: (stageValues.wonAt as Date | null | undefined) ?? null,
      lostAt: (stageValues.lostAt as Date | null | undefined) ?? null,
      status: statusPlan.status ?? undefined,
      source: input.source ?? null,
      ownerId: input.ownerId ?? null,
      channel,
      channelUid: uid,
      message: input.message ?? null,
      data: {},
      displayId,
      createdBy: null,
    });
    if (email) await this.repo.addIdentity(tx, orgId, created.id, 'email', email);
    if (phone) await this.repo.addIdentity(tx, orgId, created.id, 'phone', phone);
    await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
    return { outcome: 'created', contactId: created.id, uuid: created.uuid };
  }

  /** A name nobody has written yet is filled in; a curated one is never replaced. */
  private async fillBlankName(
    tx: Tx,
    orgId: number,
    id: number,
    name: string | null | undefined,
  ): Promise<void> {
    const text = name?.trim();
    if (!text) return;
    await tx.execute(
      sql`UPDATE contacts SET name = ${text}
           WHERE org_id = ${orgId} AND id = ${id} AND COALESCE(btrim(name), '') = ''`,
    );
  }

  private async uuidOf(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return (res.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
  }

  /** A grant claimed in a write needs proof and cannot sit beside an opt-out in the same write. */
  private assertIntakeAllowed(
    plan: IntakePlan,
    proof: ConsentProof | undefined,
    optingOut: boolean,
  ): void {
    if (plan.grant.length === 0) return;
    if (optingOut) {
      throw AppError.validation(
        'A contact cannot be marked unsubscribed and subscribed in the same change.',
      );
    }
    this.intake.requireProof(proof);
  }

  private grantSource(ctx: RequestContext, via?: ContactConsentContext): ConsentSource {
    return via?.source ?? (ctx.actorType === 'api_key' ? 'api' : 'manual');
  }

  /**
   * `create` found the person already in the workspace. If the write carried a consent claim, the agreement still happened: the grant
   * is written on that contact (never over a withdrawal) and a blank status of a granted channel becomes `subscribed`. Nothing else
   * of the existing contact is touched. Returns whether anything was written.
   */
  private async grantOnMatch(
    tx: Tx,
    ctx: RequestContext,
    existing: ContactRow,
    input: CreateContactInput,
    via?: ContactConsentContext,
  ): Promise<boolean> {
    const plan = planIntakeGrants({
      given: statusesOf(input),
      stored: {
        whatsapp: existing.whatsappSubscriptionStatus,
        sms: existing.smsSubscriptionStatus,
        email: existing.emailSubscriptionStatus,
      },
      proof: input.consent,
      reachable: { phone: Boolean(existing.phone), email: Boolean(existing.email) },
    });
    if (plan.grant.length === 0) return false;
    this.intake.requireProof(input.consent);
    const recorded = await this.intake.grant(tx, ctx.orgId, {
      contactId: existing.id,
      channels: plan.grant,
      source: this.grantSource(ctx, via),
      proof: input.consent,
      evidence: via?.evidence,
      actorUserId: ctx.userId,
      keyBase: via?.dedupeKey ?? `create:${existing.uuid}:${randomUUID()}:grant`,
    });
    const patch: Record<string, unknown> = {};
    const stored: Record<IntakeChannel, string | null> = {
      whatsapp: existing.whatsappSubscriptionStatus,
      sms: existing.smsSubscriptionStatus,
      email: existing.emailSubscriptionStatus,
    };
    for (const ch of recorded as IntakeChannel[]) {
      if (!(stored[ch] ?? '').trim()) patch[STATUS_COLUMN[ch]] = 'subscribed';
    }
    if (Object.keys(patch).length > 0) {
      await this.repo.updateFieldsById(tx, ctx.orgId, existing.id, {
        ...patch,
        updatedBy: ctx.userId,
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: Object.fromEntries(
          Object.keys(patch).map((k) => [k, { old: null, new: 'subscribed' }]),
        ),
      });
    }
    return recorded.length > 0;
  }

  async update(
    uuid: string,
    input: UpdateContactInput,
    via?: ContactConsentContext,
  ): Promise<ContactResponse> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Contact', uuid);
      const canRevealPhone = this.rbac.can(ctx.grants!, 'contacts.phone.reveal').allowed;
      const updateScope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(tx, this.repo, ctx.orgId, updateScope, ctx.userId!, existing);

      const values: Record<string, unknown> = { updatedBy: ctx.userId };
      if (input.name !== undefined) values.name = input.name;
      if (input.firstName !== undefined) values.firstName = input.firstName;
      if (input.lastName !== undefined) values.lastName = input.lastName;
      if (input.email !== undefined) values.email = input.email;
      const phone = input.phone
        ? (canonicalizePhone({ number: input.phone })?.e164 ?? input.phone)
        : input.phone;
      if (phone !== undefined) values.phone = phone;
      if (input.lostReason !== undefined) values.lostReason = input.lostReason;
      if (input.otherLostReason !== undefined) values.otherLostReason = input.otherLostReason;
      if (input.leadScore !== undefined) {
        values.leadScore = input.leadScore;
        // A score a person types (or clears) takes the AI's explanation with it: the number is theirs now, and clearing it hands the
        // contact back to the AI scorer.
        values.leadScoreSource = input.leadScore === null ? null : 'manual';
        values.leadScoreReasons = null;
        values.leadScoredAt = null;
        values.leadScoreModel = null;
      }
      // Consent at intake: a status that changes to `subscribed`, or a consent block, is a claim that the person agreed. It needs proof
      // and writes a ledger grant below; the status alone never grants anything (spec privacy-and-data-governance 4.3.2).
      const plan = planIntakeGrants({
        given: statusesOf(input),
        stored: {
          whatsapp: existing.whatsappSubscriptionStatus,
          sms: existing.smsSubscriptionStatus,
          email: existing.emailSubscriptionStatus,
        },
        proof: input.consent,
        reachable: {
          phone: Boolean(input.phone !== undefined ? input.phone : existing.phone),
          email: Boolean(input.email !== undefined ? input.email : existing.email),
        },
      });
      this.assertIntakeAllowed(plan, input.consent, input.isUnsubscribed === true);
      for (const ch of plan.fillStatus) values[STATUS_COLUMN[ch]] = 'subscribed';
      if (input.whatsappSubscriptionStatus !== undefined) {
        values.whatsappSubscriptionStatus = input.whatsappSubscriptionStatus;
      }
      if (input.smsSubscriptionStatus !== undefined) {
        values.smsSubscriptionStatus = input.smsSubscriptionStatus;
      }
      if (input.emailSubscriptionStatus !== undefined) {
        values.emailSubscriptionStatus = input.emailSubscriptionStatus;
      }
      if (input.emailConfirmed !== undefined) values.emailConfirmed = input.emailConfirmed;
      if (input.faxNumber !== undefined) values.faxNumber = input.faxNumber;
      if (input.dateOfBirth !== undefined) values.dateOfBirth = input.dateOfBirth;
      if (input.source !== undefined) values.source = input.source;
      // The contact's own time zone (BL-193): who set it is recorded with it, so a zone read from the number never replaces a chosen one.
      if (input.timezone !== undefined) {
        values.timezone = input.timezone;
        values.timezoneSource = input.timezone === null ? null : timezoneSourceOf(ctx, via);
      }
      // Marketing opt-out (TW-CON-017): the timestamp is written with the flag, on every change, so the evidence is never
      // missing (Reference left it empty on a manual change). No change, nothing touched.
      if (input.isUnsubscribed !== undefined && input.isUnsubscribed !== existing.isUnsubscribed) {
        values.isUnsubscribed = input.isUnsubscribed;
        values.unsubscribedAt = input.isUnsubscribed ? new Date() : null;
      }
      // lifecycle_stage is NOT NULL: a null stage is "leave it", not a clear.
      if (input.lifecycleStage != null && input.lifecycleStage !== existing.lifecycleStage) {
        // Track the transition, not just the current value — the sub-agent
        // portal and the pipeline UI both read "what was it before".
        values.lifecycleStage = input.lifecycleStage;
        values.lifecycleStageDate = new Date();
        values.previousLifecycleStage = existing.lifecycleStage;
        values.previousLifecycleStageDate = existing.lifecycleStageDate;
        // Entering a won or lost stage stamps it (a lost one needs a reason); leaving one clears the stamp.
        Object.assign(
          values,
          stageEntryValues({
            flags: await this.repo.stageFlags(tx, ctx.orgId, input.lifecycleStage),
            current: existing,
            lostReason: input.lostReason,
            otherLostReason: input.otherLostReason,
            now: new Date(),
          }),
        );
      }
      // The status stays valid for the stage: a stage move that leaves it invalid resets it (to the new stage's default, or
      // none), and a status set by the caller must belong to the contact's (new) stage (422 CON_STATUS_STAGE_MISMATCH).
      const nextStage = (values.lifecycleStage as string | undefined) ?? existing.lifecycleStage;
      if (input.status !== undefined || values.lifecycleStage !== undefined) {
        const statusCtx = await this.repo.statusContext(tx, ctx.orgId);
        const plan = planStatus({
          scope: statusCtx.scope,
          stage: nextStage,
          stageLabel: statusCtx.stageLabels.get(nextStage) ?? null,
          stageChanged: values.lifecycleStage !== undefined,
          current: existing.status,
          requested: input.status,
        });
        if (plan.status !== undefined) values.status = plan.status;
      }
      if (input.customFields !== undefined) {
        assertFormFieldLimits(input.customFields);
        // Merge, don't replace: a client that sends three fields must not wipe
        // the other forty the org has defined.
        await this.assertPropertiesWritable(tx, ctx.orgId, input.customFields, existing.data ?? {});
        values.data = { ...(existing.data ?? {}), ...input.customFields };
        // A save answers for the properties it names and for the ones it makes required, not for every required property of the
        // workspace: an inline edit of one property (the job title) must not fail because the contact never had a value for some
        // other required property, e.g. one added after the contact was created. The contact form sends all its properties, so it
        // still answers for all of them. A stage or owner change alone is not held to any (see requiredScopeOfEdit).
        const data = values.data as Record<string, unknown>;
        await this.assertRequiredProperties(tx, ctx.orgId, data, (rules) =>
          requiredScopeOfEdit(rules, existing.data ?? {}, data, Object.keys(input.customFields!)),
        );
      }
      if (input.ownerId !== undefined) {
        const nextOwner = input.ownerId
          ? await this.requireUser(tx, ctx.orgId, input.ownerId)
          : null;
        if (nextOwner !== existing.ownerId) {
          await this.assertOwnerAllowed(tx, 'record.contacts.update', nextOwner);
        }
        values.ownerId = nextOwner;
      }
      if (input.companyId !== undefined) {
        values.companyId = input.companyId
          ? await this.requireCompany(tx, ctx.orgId, input.companyId, existing.companyId)
          : null;
      }

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('Contact');
      // A new owner puts the contact back to uncontacted when the workspace says so (BL-290).
      if (values.ownerId != null && values.ownerId !== existing.ownerId) {
        await this.touch.afterReassign(tx, ctx.orgId, [existing.id]);
      }

      // The identity keys follow the contact: the old address or number is released (an edit or a clear), the new one claimed.
      if (input.email !== undefined && existing.email && input.email !== existing.email) {
        await this.repo.removeIdentity(tx, ctx.orgId, existing.id, 'email', existing.email);
      }
      if (input.email && input.email !== existing.email) {
        await this.repo.addIdentity(tx, ctx.orgId, existing.id, 'email', input.email);
      }
      if (phone !== undefined && existing.phone && phone !== existing.phone) {
        await this.repo.removeIdentity(tx, ctx.orgId, existing.id, 'phone', existing.phone);
      }
      if (phone && phone !== existing.phone) {
        await this.repo.addIdentity(tx, ctx.orgId, existing.id, 'phone', phone);
      }

      // The toggle on the contact form / REST API keeps working as before; the ledger records who changed it (a grant here has no
      // required reason: the Consent card on the profile asks for one).
      // Switching the flag back on while the write carries the person's proof records THAT proof (the wording, the version, the note)
      // instead of the bare "changed on the record" line, and covers the WhatsApp grant of the consent block.
      const proofForFlag =
        values.isUnsubscribed === false && hasProof(input.consent) ? input.consent : undefined;
      if (values.isUnsubscribed !== undefined) {
        await this.consent.recordInTx(tx, ctx.orgId, {
          contactId: existing.id,
          channel: 'whatsapp',
          action: values.isUnsubscribed ? 'withdrawn' : 'granted',
          source: this.grantSource(ctx, via),
          evidence: proofForFlag ? intakeEvidence(proofForFlag, via?.evidence) : undefined,
          actorUserId: ctx.userId,
          note: proofForFlag?.note?.trim() || 'Changed on the contact record',
          idempotencyKey: `edit:${existing.uuid}:${existing.rowVersion}`,
        });
        // Switching the flag back on is a person coming back: `contact.opt_in` (optedIn: true), the opt-in flow trigger, in the same
        // transaction as the change, like the STOP / START keyword and the Consent card. The ledger cannot announce it here (this update
        // has already moved the flag, so the ledger sees no change). Switching it off announces nothing, as before.
        if (values.isUnsubscribed === false) {
          await this.outbox.emit(tx, {
            aggregateModule: MODULE_KEY,
            aggregateId: existing.id,
            eventType: 'contact.opt_in',
            payload: {
              contactId: existing.uuid,
              optedIn: true,
              action: 'resubscribed',
              source: ctx.actorType === 'api_key' ? 'api' : 'manual',
            },
          });
        }
      }

      const grantChannels = proofForFlag
        ? plan.grant.filter((ch) => ch !== 'whatsapp')
        : plan.grant;
      if (grantChannels.length > 0) {
        await this.intake.grant(tx, ctx.orgId, {
          contactId: existing.id,
          channels: grantChannels,
          source: this.grantSource(ctx, via),
          proof: input.consent,
          evidence: via?.evidence,
          actorUserId: ctx.userId,
          keyBase: via?.dedupeKey ?? `edit:${existing.uuid}:${existing.rowVersion}:grant`,
        });
      }

      // The date of birth moved: the flag follows it (flagged, kept, or lifted once the contact is of age).
      if (input.dateOfBirth !== undefined && input.dateOfBirth !== existing.dateOfBirth) {
        await this.minors.evaluateInTx(tx, ctx.orgId, existing.id, new Date(), {
          dobChanged: true,
        });
      }

      const after = await this.repo.findById(tx, ctx.orgId, existing.id);

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          existing as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
        ),
      });

      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType:
          existing.lifecycleStage !== after!.lifecycleStage
            ? 'contact.stage_changed'
            : 'contact.updated',
        payload: {
          uuid,
          previousStage: existing.lifecycleStage,
          stage: after!.lifecycleStage,
        },
      });

      return toContactResponse(after!, { canRevealPhone });
    });
  }

  /**
   * Hard delete. With `eraseHistory` (the default) the contact's conversations, messages, media, files, call logs and recordings go
   * with it (the shared erasure pipeline of the rights service); without it they are kept without the person's identity. Leads,
   * deals, tasks and invoices stay as business records. Either way nothing is left pointing at the person by number or name.
   */
  async remove(uuid: string, opts: { eraseHistory?: boolean } = {}): Promise<void> {
    const ctx = RequestContextStore.require();
    const eraseHistory = opts.eraseHistory ?? true;

    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Contact', uuid);
      await this.repo.lockById(tx, ctx.orgId, existing.id);
      const deleteScope = this.rbac.can(ctx.grants!, 'record.contacts.delete').scope;
      await assertContactScope(tx, this.repo, ctx.orgId, deleteScope, ctx.userId!, existing);

      // The history first, in the same transaction: the conversations are found through the contact link, which the delete below
      // clears. A call that loses the race below rolls this back with it.
      await this.erasure.eraseContactHistory(
        tx,
        ctx.orgId,
        [existing.id],
        eraseHistory ? 'delete' : 'anonymise',
      );

      // Hard delete. The delete itself decides who won a race (AZ-014): `DELETE ... RETURNING` reports a row only to the
      // call that removed it, and a second concurrent call (which waited on the row lock) gets 404 and writes nothing.
      // The audit row and the outbox event follow in the same transaction; the audit trail keeps the record id.
      const removed = await this.repo.deleteById(tx, ctx.orgId, existing.id);
      if (!removed) throw AppError.notFound('Contact', uuid);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
        delta: { history: { old: null, new: eraseHistory ? 'erased' : 'anonymised' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact.deleted',
        payload: { uuid, displayId: existing.displayId },
      });
    });
  }

  /**
   * AZ-007: the record scope of the permission that governs the write also bounds who the contact may be handed to (the
   * caller themselves, a teammate, or anyone for `all`). A caller without grants (a system actor) is not scoped.
   */
  private async assertOwnerAllowed(
    tx: Tx,
    permission: 'record.contacts.create' | 'record.contacts.update',
    nextOwnerId: number | null,
  ): Promise<void> {
    const ctx = RequestContextStore.require();
    if (!ctx.grants) return;
    await assertOwnerWithinScope({
      scope: this.rbac.can(ctx.grants, permission).scope,
      actorUserId: ctx.userId,
      nextOwnerId,
      inActorTeam: (id, below) =>
        this.repo.isOwnerInActorTeam(tx, ctx.orgId, ctx.userId!, id, below),
      path: 'ownerId',
    });
  }

  /**
   * AZ-008: a single create or update holds custom properties to the same field flags the bulk update does. A property the
   * workspace defined that is hidden, read-only, a formula, a system property or inactive cannot be written (422
   * CON_PROPERTY_NOT_EDITABLE). Only keys whose value CHANGES are held to it, so a form that sends back the whole object
   * it loaded still saves. Free-form keys the workspace never defined keep their existing behaviour. System actors are not held.
   */
  private async assertPropertiesWritable(
    tx: Tx,
    orgId: number,
    incoming: Record<string, unknown> | undefined,
    current: Record<string, unknown>,
  ): Promise<void> {
    if (!incoming || !RequestContextStore.require().grants) return;
    const changed = Object.keys(incoming).filter(
      (k) => JSON.stringify(incoming[k] ?? null) !== JSON.stringify(current[k] ?? null),
    );
    if (changed.length === 0) return;
    const defined = await this.repo.definedPropertyKeys(tx, orgId, changed);
    if (defined.size === 0) return;
    const editable = await this.repo.editableProperties(tx, orgId, [...defined]);
    const blocked = [...defined].filter((k) => !editable.has(k));
    if (blocked.length === 0) return;
    throw new AppError(
      ERROR_CODES.CON_PROPERTY_NOT_EDITABLE,
      `Not an editable custom property: ${blocked.join(', ')}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      blocked.map((k) => ({ path: `customFields.${k}`, message: 'not an editable property' })),
    );
  }

  /** 422 CON_REQUIRED_PROPERTY_MISSING when properties the registry marks required have no value (honouring dependencies). */
  private async assertRequiredProperties(
    tx: Tx,
    orgId: number,
    data: Record<string, unknown>,
    scope?: ReadonlySet<string> | ((rules: readonly RequiredRule[]) => ReadonlySet<string>),
  ): Promise<void> {
    const rules = await this.repo.requiredRules(tx, orgId);
    const missing = missingRequired(
      rules,
      data,
      typeof scope === 'function' ? scope(rules) : scope,
    );
    if (missing.length > 0) throw requiredPropertiesError(missing);
  }

  private async requireUser(
    tx: Parameters<typeof this.repo.resolveUserId>[0],
    orgId: number,
    uuid: string,
  ) {
    const id = await this.repo.resolveUserId(tx, orgId, uuid);
    if (id === undefined) throw AppError.notFound('User', uuid);
    return id;
  }

  /**
   * A company to link: in this workspace (404 otherwise), and, when the link is new, one the caller may read (the capability and
   * their record scope). A company the contact already has stays linkable by someone who cannot read it, so saving an unrelated
   * field of a contact never fails on it.
   */
  private async requireCompany(
    tx: Parameters<typeof this.repo.resolveCompanyId>[0],
    orgId: number,
    uuid: string,
    current: number | null = null,
  ) {
    const id = await this.repo.resolveCompanyId(tx, orgId, uuid);
    if (id === undefined) throw companyLinkRefused('notFound');
    if (id !== current) await assertCompanyReadable(tx, this.rbac, orgId, id);
    return id;
  }

  async listFieldHistory(
    uuid: string,
    query: ListFieldHistoryQuery,
  ): Promise<PageResponse<FieldHistoryEntry>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!contact) throw AppError.notFound('Contact', uuid);
      const readScope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(tx, this.repo, ctx.orgId, readScope, ctx.userId!, contact);

      const { items, nextCursor, hasMore } = await this.audit.listByRecord(
        tx,
        ctx.orgId,
        MODULE_KEY,
        contact.id,
        { limit: query.limit, cursor: query.cursor },
      );

      const actorIds = [
        ...new Set(items.map((i) => i.actorId).filter((id): id is number => id !== null)),
      ];
      const actorUuids = await this.repo.resolveUserUuids(tx, ctx.orgId, actorIds);

      const entries: FieldHistoryEntry[] = items.flatMap((entry) =>
        Object.entries(entry.delta ?? {}).map(([fieldKey, change]) => ({
          fieldKey,
          oldValue: (change as { old: unknown }).old,
          newValue: (change as { new: unknown }).new,
          actorType: entry.actorType,
          changedByUserId: entry.actorId !== null ? (actorUuids.get(entry.actorId) ?? null) : null,
          changedAt: entry.at.toISOString(),
        })),
      );

      return { data: entries, page: { nextCursor, hasMore, limit: query.limit } };
    });
  }

  /** The stages and statuses the caller's contacts hold, so a filter can offer a value the workspace never listed (e.g. `new`). */
  async filterValues(scope: RecordScope): Promise<ContactFilterValues> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const own = contactScopeCondition(ctx.orgId, scope, ctx.userId);
      const lifecycleStages = await stagesInUse(tx, ctx.orgId, undefined, own);
      const statuses = await statusesInUse(tx, ctx.orgId, undefined, own);
      return { lifecycleStages, statuses };
    });
  }

  async selectData(query: ContactSelectQuery, scope: RecordScope): Promise<ContactSelectItem[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) =>
      this.repo.selectData(tx, ctx.orgId, { ...query, scope, actorUserId: ctx.userId }),
    );
  }

  /**
   * Everyone active, each marked with whether the caller's record scope lets them assign a contact to that person
   * (the same rule `assertOwnerWithinScope` enforces on every write): the form offers only those, the list filter and
   * the Owner column need every name.
   */
  async listAssignees(): Promise<AssigneeResponse[]> {
    const ctx = RequestContextStore.require();
    const scope = ctx.grants ? this.rbac.can(ctx.grants, 'record.contacts.update').scope : 'all';
    return this.db.tx((tx) => this.repo.listAssignable(tx, ctx.orgId, scope, ctx.userId));
  }

  async setAssignee(input: SetContactAssigneeInput): Promise<BulkResult> {
    const ctx = RequestContextStore.require();
    const updateScope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
    return this.db.tx(async (tx) => {
      const ownerId = input.ownerId ? await this.requireUser(tx, ctx.orgId, input.ownerId) : null;
      return this.forEachRowIsolated(tx, ctx.orgId, input.ids, async (rowTx, id, uuid) => {
        const existing = await this.repo.findById(rowTx, ctx.orgId, id);
        if (!existing) throw AppError.notFound('Contact');
        await assertContactScope(rowTx, this.repo, ctx.orgId, updateScope, ctx.userId!, existing);

        if (ownerId !== existing.ownerId) {
          await this.assertOwnerAllowed(rowTx, 'record.contacts.update', ownerId);
        }
        const updated = await this.repo.updateFieldsById(rowTx, ctx.orgId, id, {
          ownerId,
          updatedBy: ctx.userId,
        });
        if (!updated) throw AppError.notFound('Contact');
        if (ownerId !== null && ownerId !== existing.ownerId) {
          await this.touch.afterReassign(rowTx, ctx.orgId, [id]);
        }

        await this.audit.record(rowTx, {
          module: MODULE_KEY,
          recordId: id,
          action: 'update',
          // input.ownerId, not the resolved internal `ownerId` above — every
          // response, field-history included, exposes uuids, never the
          // internal bigint PK.
          delta: { ownerId: { old: undefined, new: input.ownerId } },
        });
        await this.outbox.emit(rowTx, {
          aggregateModule: MODULE_KEY,
          aggregateId: id,
          eventType: 'contact.updated',
          payload: { uuid, ownerId: input.ownerId },
        });
      });
    });
  }

  /**
   * Bulk-edit: every id in one outer transaction, but each row's write runs
   * in its own SAVEPOINT (via nested `tx.transaction()`) so one bad id rolls
   * back only that row — never the whole batch. Merges customFields the same
   * way `update()` does (a partial patch, not a replace).
   */
  async bulkUpdate(input: BulkUpdateContactsInput): Promise<BulkResult> {
    const ctx = RequestContextStore.require();
    const updateScope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
    return this.db.tx(async (tx) => {
      const ownerId: number | null | undefined = input.values.ownerId
        ? await this.requireUser(tx, ctx.orgId, input.values.ownerId)
        : input.values.ownerId === null
          ? null
          : undefined; // null (unset) or undefined (leave alone) pass through
      // Read once for the whole batch; each row is planned against it.
      const statusCtx =
        input.values.status !== undefined || input.values.lifecycleStage != null
          ? await this.repo.statusContext(tx, ctx.orgId)
          : undefined;

      // Custom properties are checked once for the whole request, before any row is written: an unknown key or a value
      // that does not fit its property's type is a 422 and nothing is changed.
      const customInput = input.values.customFields;
      if (customInput !== undefined) assertFormFieldLimits(customInput);
      const propertyPlan =
        customInput !== undefined && Object.keys(customInput).length > 0
          ? planPropertyChanges(
              await this.repo.editableProperties(tx, ctx.orgId, Object.keys(customInput)),
              customInput,
            )
          : undefined;

      return this.forEachRowIsolated(tx, ctx.orgId, input.ids, async (rowTx, id, uuid) => {
        const existing = await this.repo.findById(rowTx, ctx.orgId, id);
        if (!existing) throw AppError.notFound('Contact');
        await assertContactScope(rowTx, this.repo, ctx.orgId, updateScope, ctx.userId!, existing);

        const values: Record<string, unknown> = { updatedBy: ctx.userId };
        if (input.values.ownerId !== undefined) {
          if (ownerId !== existing.ownerId) {
            await this.assertOwnerAllowed(rowTx, 'record.contacts.update', ownerId ?? null);
          }
          values.ownerId = ownerId;
        }
        if (
          input.values.lifecycleStage !== undefined &&
          input.values.lifecycleStage !== null &&
          input.values.lifecycleStage !== existing.lifecycleStage
        ) {
          values.lifecycleStage = input.values.lifecycleStage;
          values.lifecycleStageDate = new Date();
          values.previousLifecycleStage = existing.lifecycleStage;
          values.previousLifecycleStageDate = existing.lifecycleStageDate;
          Object.assign(
            values,
            stageEntryValues({
              flags: await this.repo.stageFlags(rowTx, ctx.orgId, input.values.lifecycleStage),
              current: existing,
              lostReason: input.values.lostReason,
              otherLostReason: input.values.otherLostReason,
              now: new Date(),
            }),
          );
        }
        if (statusCtx) {
          const nextStage =
            (values.lifecycleStage as string | undefined) ?? existing.lifecycleStage;
          const plan = planStatus({
            scope: statusCtx.scope,
            stage: nextStage,
            stageLabel: statusCtx.stageLabels.get(nextStage) ?? null,
            stageChanged: values.lifecycleStage !== undefined,
            current: existing.status,
            requested: input.values.status,
          });
          if (plan.status !== undefined) values.status = plan.status;
        }
        // The contact's own time zone (BL-193), set on every contact of the selection; `null` clears it. Recorded as set by staff.
        if (input.values.timezone !== undefined) {
          values.timezone = input.values.timezone;
          values.timezoneSource = input.values.timezone === null ? null : 'staff';
        }
        let changedKeys: string[] = [];
        if (propertyPlan) {
          // Merge, don't replace: the contact's other properties stay. A cleared key is removed.
          const applied = applyPropertyPlan(existing.data ?? {}, propertyPlan);
          values.data = applied.data;
          changedKeys = applied.changedKeys;
          // Only the keys this edit sets are held to the rule: it may not blank a required property, but contacts
          // that never had one are not all refused.
          await this.assertRequiredProperties(
            rowTx,
            ctx.orgId,
            applied.data,
            new Set(Object.keys(customInput!)),
          );
        }

        await this.repo.updateFieldsById(rowTx, ctx.orgId, id, values);
        // The keys that changed are recorded, never their values (a time zone is not personal data, so its change is).
        await this.audit.record(rowTx, {
          module: MODULE_KEY,
          recordId: id,
          action: 'update',
          ...(changedKeys.length > 0 || input.values.timezone !== undefined
            ? {
                delta: {
                  ...(changedKeys.length > 0
                    ? { customFieldKeys: { old: null, new: changedKeys } }
                    : {}),
                  ...(input.values.timezone !== undefined
                    ? { timezone: { old: existing.timezone, new: input.values.timezone } }
                    : {}),
                },
              }
            : {}),
        });
        await this.outbox.emit(rowTx, {
          aggregateModule: MODULE_KEY,
          aggregateId: id,
          eventType:
            input.values.lifecycleStage !== undefined &&
            input.values.lifecycleStage !== existing.lifecycleStage
              ? 'contact.stage_changed'
              : 'contact.updated',
          payload: {
            uuid,
            previousStage: existing.lifecycleStage,
            stage: input.values.lifecycleStage ?? existing.lifecycleStage,
            ...(changedKeys.length > 0 ? { customFieldKeys: changedKeys } : {}),
          },
        });
      });
    });
  }

  /**
   * Resolves every uuid to an internal id up front (a uuid that does not
   * exist fails immediately, no savepoint needed), then runs `fn` for each
   * resolved row inside its own SAVEPOINT so a mid-batch failure — a 404
   * that raced with a concurrent delete, a constraint violation — rolls
   * back only that row.
   */
  private async forEachRowIsolated(
    tx: Tx,
    orgId: number,
    uuids: string[],
    fn: (rowTx: Tx, id: number, uuid: string) => Promise<void>,
  ): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: BulkResult['failed'] = [];

    // One query for the whole batch (up to BULK_IDS_MAX uuids), not one per row.
    const ids = await this.repo.idsByUuid(tx, orgId, uuids);

    for (const uuid of uuids) {
      const id = ids.get(uuid);
      if (id === undefined) {
        failed.push({ id: uuid, code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' });
        continue;
      }
      try {
        await tx.transaction((rowTx) => fn(rowTx, id, uuid));
        succeeded.push(uuid);
      } catch (err) {
        const message = err instanceof AppError ? err.message : 'Unexpected error';
        const code = err instanceof AppError ? err.code : ERROR_CODES.INTERNAL;
        failed.push({ id: uuid, code, message });
      }
    }

    return { succeeded, failed };
  }
}
