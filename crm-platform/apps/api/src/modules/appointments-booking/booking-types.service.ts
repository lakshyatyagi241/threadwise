import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  defaultStepKind,
  type AppointmentMessageKind,
  type BookingReminderStepKind,
  type BookingTypeListResponse,
  type BookingTypeOption,
  type BookingTypeResponse,
  type CreateBookingTypeInput,
  type ListBookingTypesQuery,
  type PreviewSlotsInput,
  type PreviewSlotsResponse,
  type SlotsQuery,
  type SlotsResponse,
  type UpdateBookingTypeInput,
  type UpsertOverrideInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanUsageService } from '../plans-subscriptions-trials';
import { ReminderPlan } from './reminder-plan';
import { AppointmentChannelsRepository } from './appointment-channels.repository';
import { AppointmentChannelsService } from './appointment-channels.service';
import { toApiTemplate } from './appointment-template.mapper';
import { BOOKING_TYPE_MODULE, priceInMinor, slugify } from './appointment-rules';
import { AppointmentsRepository } from './appointments.repository';
import {
  toBookingTypeOption,
  toBookingTypeResponse,
  type TypeContext,
} from './appointments-booking.mapper';
import {
  BookingTypesRepository,
  type BookingTypeRow,
  type TypeChildren,
  type TypePatch,
} from './booking-types.repository';
import { resolveZone, SlotsService } from './slots.service';
import { addDays, startOfLocalDay } from './tz';

const MAX_SLUG_TRIES = 50;

/** The library message kind each step of a reminder sequence sends. */
const LIBRARY_KIND_OF_STEP: Record<BookingReminderStepKind, AppointmentMessageKind> = {
  confirmation: 'confirmation',
  reminder_24h: 'reminder',
  reminder_2h: 'reminder',
  reminder_15m: 'reminder',
  reminder: 'reminder',
  after_visit: 'follow_up',
  no_show: 'no_show',
  rebook: 'rebook',
};

/** The child lists a create or an update body may carry (the same shapes in both). */
type ChildLists = Pick<
  UpdateBookingTypeInput,
  'availability' | 'overrides' | 'questions' | 'reminders' | 'templates' | 'payment' | 'calendar'
>;

/**
 * Booking types (TW-APPT-005..016). One transaction per operation: the row lock, the writes to the type and every child, the audit
 * row and the outbox event commit together or not at all.
 *
 * What differs from Reference (all in the inventory's "Port decisions"): `PATCH` takes the row version and keeps any child list that is
 * not sent (Reference replaced everything on every save, so every edit deleted the date overrides); children that carry an id keep
 * their rows; special-hours overrides are honoured; a type with bookings still to come is not deleted; money is a decimal string in
 * the currency's own decimals and a partial deposit cannot exceed the price; the host is an active member.
 */
@Injectable()
export class BookingTypesService {
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BookingTypesRepository,
    private readonly appts: AppointmentsRepository,
    private readonly slots: SlotsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly planUsage: PlanUsageService,
    private readonly reminderPlan: ReminderPlan,
    private readonly channels: AppointmentChannelsService,
    private readonly library: AppointmentChannelsRepository,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // --- reads -----------------------------------------------------------------------------------------------------------

  async list(query: ListBookingTypesQuery): Promise<BookingTypeListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query);
      const children = await this.repo.children(
        tx,
        ctx.orgId,
        rows.map((r) => r.id),
      );
      const tc = await this.typeContext(tx, ctx.orgId);
      return { data: rows.map((r) => toBookingTypeResponse(r, children.get(r.id)!, tc)) };
    });
  }

  async options(): Promise<BookingTypeOption[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) =>
      (await this.repo.list(tx, ctx.orgId, {})).map(toBookingTypeOption),
    );
  }

  async get(uuid: string): Promise<BookingTypeResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => this.read(tx, ctx.orgId, uuid));
  }

  /** The slots of a saved type, as staff see them (the same engine the customer's page uses). */
  async slotsFor(uuid: string, query: SlotsQuery): Promise<SlotsResponse> {
    const ctx = RequestContextStore.require();
    const nowMs = Date.now();
    const lt = await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Booking type', uuid);
      return this.slots.load(tx, ctx.orgId, row);
    });
    const window = this.slots.window(query, lt, nowMs);
    const tz = lt.engine.timezone;
    const busy = await this.slots.busyFor(
      ctx.orgId,
      lt,
      startOfLocalDay(window.fromDate, tz) - 86_400_000,
      startOfLocalDay(addDays(window.toDate, 1), tz) + 86_400_000,
    );
    return this.db.tx((tx) => this.slots.slots(tx, ctx.orgId, lt, query, nowMs, busy));
  }

  async preview(input: PreviewSlotsInput): Promise<PreviewSlotsResponse> {
    const ctx = RequestContextStore.require();
    const tz = await this.db.tx((tx) => this.slots.orgTimezone(tx, ctx.orgId));
    return this.slots.preview(input, tz, Date.now());
  }

  // --- writes ----------------------------------------------------------------------------------------------------------

  async create(input: CreateBookingTypeInput): Promise<BookingTypeResponse> {
    const ctx = RequestContextStore.require();
    // The plan's `booking_types` cap (a live count: deleting a type frees the slot).
    return this.db.tx(async (tx) => {
      await this.planUsage.assertCanAddIn(tx, ctx.orgId, 'booking_types');
      const hostId = await this.resolveHost(tx, ctx.orgId, input.hostId, ctx.userId);
      const slug = await this.uniqueSlug(tx, ctx.orgId, input.slug || input.name);
      const id = await this.repo.insert(tx, ctx.orgId, {
        user_id: hostId,
        name: input.name,
        slug,
        description: input.description ?? null,
        location_type: input.locationType,
        location_value: input.locationValue ?? null,
        color: input.color ?? null,
        intro_message: input.introMessage ?? null,
        approval_required: input.approvalRequired,
        is_active: input.isActive,
        sort_order: input.sortOrder,
        duration_minutes: input.durationMinutes,
        increment_minutes: input.incrementMinutes ?? input.durationMinutes,
        buffer_before_minutes: input.bufferBeforeMinutes,
        buffer_after_minutes: input.bufferAfterMinutes,
        min_notice_minutes: input.minNoticeMinutes,
        max_advance_days: input.maxAdvanceDays,
        max_per_day: input.maxPerDay ?? null,
        capacity: input.capacity,
        timezone: input.timezone ?? null,
      });
      await this.writeChildren(tx, ctx.orgId, id, input, input.locationType, true);
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.record(tx, ctx.orgId, row, 'insert', undefined, 'booking_type.created');
      return this.respond(tx, ctx.orgId, row);
    });
  }

  async update(uuid: string, input: UpdateBookingTypeInput): Promise<BookingTypeResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Booking type', uuid);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Booking type');

      const patch: TypePatch = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const set = (col: string, key: string, next: unknown, prev: unknown) => {
        if (next === prev) return;
        patch[col] = next;
        delta[key] = { old: prev, new: next };
      };
      if (input.name !== undefined) set('name', 'name', input.name, row.name);
      if (input.description !== undefined)
        set('description', 'description', input.description ?? null, row.description);
      if (input.locationType !== undefined)
        set('location_type', 'locationType', input.locationType, row.locationType);
      if (input.locationValue !== undefined)
        set('location_value', 'locationValue', input.locationValue ?? null, row.locationValue);
      if (input.color !== undefined) set('color', 'color', input.color ?? null, row.color);
      if (input.introMessage !== undefined)
        set('intro_message', 'introMessage', input.introMessage ?? null, row.introMessage);
      if (input.approvalRequired !== undefined)
        set('approval_required', 'approvalRequired', input.approvalRequired, row.approvalRequired);
      if (input.isActive !== undefined) set('is_active', 'isActive', input.isActive, row.isActive);
      if (input.sortOrder !== undefined)
        set('sort_order', 'sortOrder', input.sortOrder, row.sortOrder);
      if (input.durationMinutes !== undefined)
        set('duration_minutes', 'durationMinutes', input.durationMinutes, row.durationMinutes);
      if (input.incrementMinutes !== undefined)
        set('increment_minutes', 'incrementMinutes', input.incrementMinutes, row.incrementMinutes);
      if (input.bufferBeforeMinutes !== undefined)
        set(
          'buffer_before_minutes',
          'bufferBeforeMinutes',
          input.bufferBeforeMinutes,
          row.bufferBeforeMinutes,
        );
      if (input.bufferAfterMinutes !== undefined)
        set(
          'buffer_after_minutes',
          'bufferAfterMinutes',
          input.bufferAfterMinutes,
          row.bufferAfterMinutes,
        );
      if (input.minNoticeMinutes !== undefined)
        set('min_notice_minutes', 'minNoticeMinutes', input.minNoticeMinutes, row.minNoticeMinutes);
      if (input.maxAdvanceDays !== undefined)
        set('max_advance_days', 'maxAdvanceDays', input.maxAdvanceDays, row.maxAdvanceDays);
      if (input.maxPerDay !== undefined)
        set('max_per_day', 'maxPerDay', input.maxPerDay ?? null, row.maxPerDay);
      if (input.timezone !== undefined)
        set('timezone', 'timezone', input.timezone ?? null, row.timezone);
      if (input.capacity !== undefined && input.capacity !== row.capacity) {
        if (
          input.capacity < row.capacity &&
          (await this.appts.seatsAbove(tx, ctx.orgId, row.id, input.capacity))
        ) {
          throw AppError.validation('Bookings still to come hold seats above that capacity.', [
            { path: 'capacity', message: 'seats_in_use' },
          ]);
        }
        set('capacity', 'capacity', input.capacity, row.capacity);
      }
      if (input.slug !== undefined && slugify(input.slug) !== row.slug) {
        set('slug', 'slug', await this.uniqueSlug(tx, ctx.orgId, input.slug, row.id), row.slug);
      }
      if (input.hostId !== undefined) {
        const host = await this.resolveHost(tx, ctx.orgId, input.hostId, null);
        if (host !== row.hostId) {
          patch.user_id = host;
          delta.host = { old: row.hostUuid, new: input.hostId };
        }
      }
      const childrenSent = await this.writeChildren(
        tx,
        ctx.orgId,
        row.id,
        input,
        input.locationType ?? row.locationType,
        false,
      );
      if (Object.keys(patch).length > 0) {
        const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, patch);
        if (!ok) throw AppError.rowVersionConflict('Booking type');
      } else if (childrenSent.length > 0) {
        // Only children changed: touch the row so its version moves and a stale editor is told.
        await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, { name: row.name });
      }
      for (const c of childrenSent) delta[c] = { old: 'changed', new: 'changed' };
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      if (Object.keys(delta).length > 0) {
        await this.record(tx, ctx.orgId, after, 'update', delta, 'booking_type.updated');
      }
      return this.respond(tx, ctx.orgId, after);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Booking type', uuid);
      if (await this.repo.hasUpcoming(tx, ctx.orgId, row.id)) {
        throw new AppError(
          ERROR_CODES.BOOKING_TYPE_HAS_UPCOMING,
          'This service has bookings still to come. Cancel or finish them first, or pause the service instead.',
          HttpStatus.CONFLICT,
        );
      }
      await this.repo.delete(tx, ctx.orgId, row.id);
      await this.record(
        tx,
        ctx.orgId,
        row,
        'delete',
        { name: { old: row.name, new: null } },
        'booking_type.deleted',
      );
    });
  }

  /** Adds or changes one date's override (a holiday, special hours) without touching the rest of the type. */
  async upsertOverride(
    uuid: string,
    date: string,
    input: UpsertOverrideInput,
  ): Promise<BookingTypeResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Booking type', uuid);
      await this.repo.upsertOverride(tx, ctx.orgId, row.id, {
        date,
        isClosed: input.isClosed,
        from: input.isClosed ? null : (input.from ?? null),
        to: input.isClosed ? null : (input.to ?? null),
        reason: input.reason ?? null,
      });
      // The type's version moves, so an open editor learns that its hours changed.
      await this.repo.update(tx, ctx.orgId, row.id, undefined, { name: row.name });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.record(
        tx,
        ctx.orgId,
        after,
        'update',
        { overrides: { old: 'changed', new: date } },
        'booking_type.updated',
      );
      return this.respond(tx, ctx.orgId, after);
    });
  }

  async deleteOverride(uuid: string, date: string): Promise<BookingTypeResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Booking type', uuid);
      if (!(await this.repo.deleteOverride(tx, ctx.orgId, row.id, date))) {
        throw AppError.notFound('Override', date);
      }
      await this.repo.update(tx, ctx.orgId, row.id, undefined, { name: row.name });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.record(
        tx,
        ctx.orgId,
        after,
        'update',
        { overrides: { old: date, new: null } },
        'booking_type.updated',
      );
      return this.respond(tx, ctx.orgId, after);
    });
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  /** Writes the child lists a body names; returns which ones it touched. `fresh` = a new type (defaults apply). */
  private async writeChildren(
    tx: Tx,
    orgId: number,
    typeId: number,
    input: ChildLists,
    locationType: string,
    fresh: boolean,
  ): Promise<string[]> {
    const touched: string[] = [];
    if (input.availability !== undefined) {
      await this.repo.replaceRules(tx, orgId, typeId, input.availability);
      touched.push('availability');
    }
    if (input.overrides !== undefined) {
      const dates = input.overrides.map((o) => o.date);
      if (new Set(dates).size !== dates.length) {
        throw AppError.validation('Two overrides name the same date.', [
          { path: 'overrides', message: 'duplicate_date' },
        ]);
      }
      await this.repo.replaceOverrides(
        tx,
        orgId,
        typeId,
        input.overrides.map((o) => ({
          date: o.date,
          isClosed: o.isClosed,
          from: o.isClosed ? null : (o.from ?? null),
          to: o.isClosed ? null : (o.to ?? null),
          reason: o.reason ?? null,
        })),
      );
      touched.push('overrides');
    }
    if (input.questions !== undefined) {
      const existing = (await this.repo.children(tx, orgId, [typeId])).get(typeId)!.questions;
      const known = new Set(existing.map((q) => q.uuid));
      for (const q of input.questions) {
        if (q.id && !known.has(q.id)) {
          throw AppError.validation('A question does not belong to this service.', [
            { path: 'questions', message: q.id },
          ]);
        }
      }
      await this.repo.syncQuestions(
        tx,
        orgId,
        typeId,
        input.questions.map((q) => ({
          uuid: q.id,
          label: q.label,
          type: q.type,
          options: q.type === 'select' ? (q.options ?? []) : null,
          required: q.required,
          mapToContactField: q.mapToContactField ?? null,
        })),
      );
      touched.push('questions');
    }
    if (input.reminders !== undefined) {
      const existing = (await this.repo.children(tx, orgId, [typeId])).get(typeId)!.reminders;
      const known = new Set(existing.map((r) => r.uuid));
      for (const r of input.reminders) {
        if (r.id && !known.has(r.id)) {
          throw AppError.validation('A reminder does not belong to this service.', [
            { path: 'reminders', message: r.id },
          ]);
        }
      }
      // A rule may name only channels the owner switched on. A channel the rule already had is not asked again (so a type keeps saving
      // after the owner switches a channel off); a rule that is being switched on is asked about all of its channels.
      const added: Array<{ channel: string; path: string }> = [];
      input.reminders.forEach((r, i) => {
        if (!r.isActive) return;
        const before = r.id ? existing.find((e) => e.uuid === r.id) : undefined;
        const had = before?.isActive ? new Set<string>(before.channels) : new Set<string>();
        for (const c of r.channels)
          if (!had.has(c)) added.push({ channel: c, path: `reminders.${i}.channels` });
      });
      await this.channels.assertEnabled(tx, orgId, added);
      // Two parts of a sequence are plan features (default on): the Confirm / Reschedule / Cancel buttons and the rebook (recall) steps.
      // Asked only for what is being switched on, so a plan that lost one still saves everything else.
      for (const r of input.reminders) {
        if (!r.isActive) continue;
        const before = r.id ? existing.find((e) => e.uuid === r.id) : undefined;
        const step = r.stepKind ?? defaultStepKind(r.kind, r.offsetMinutes);
        if (step === 'rebook' && !(before?.isActive && before.stepKind === 'rebook')) {
          await this.reminderPlan.assert(orgId, 'rebook');
        }
        if (r.buttonsEnabled && !(before?.isActive && before.buttonsEnabled)) {
          await this.reminderPlan.assert(orgId, 'buttons');
        }
      }
      const waIds = await this.repo.resolveWaTemplates(
        tx,
        orgId,
        input.reminders.flatMap((r) => (r.waTemplateId ? [r.waTemplateId] : [])),
      );
      // An email message of the library: it must exist, be an email, and be of the kind the step sends.
      const libs = await this.library.findLibraryMany(
        tx,
        orgId,
        input.reminders.flatMap((r) => (r.libraryTemplateId ? [r.libraryTemplateId] : [])),
      );
      await this.repo.syncReminders(
        tx,
        orgId,
        typeId,
        input.reminders.map((r, i) => {
          if (r.waTemplateId && !waIds.has(r.waTemplateId)) {
            throw AppError.validation('That WhatsApp template does not exist in this workspace.', [
              { path: `reminders.${i}.waTemplateId`, message: r.waTemplateId },
            ]);
          }
          const stepKind: BookingReminderStepKind =
            r.stepKind ?? defaultStepKind(r.kind, r.offsetMinutes);
          let libraryId: number | null = null;
          if (r.libraryTemplateId) {
            const lib = libs.find((m) => m.uuid === r.libraryTemplateId);
            const path = `reminders.${i}.libraryTemplateId`;
            if (!lib) {
              throw AppError.validation('That message is not in the library of this workspace.', [
                { path, message: r.libraryTemplateId },
              ]);
            }
            if (lib.channel !== 'email' || lib.kind !== LIBRARY_KIND_OF_STEP[stepKind]) {
              throw AppError.validation('That message does not fit this step.', [
                { path, message: r.libraryTemplateId },
              ]);
            }
            libraryId = lib.id;
          }
          return {
            uuid: r.id,
            offsetMinutes: r.offsetMinutes,
            label: r.label && r.label.trim() !== '' ? r.label : null,
            isActive: r.isActive,
            kind: r.kind,
            stepKind,
            channels: r.channels,
            subject: r.subject && r.subject.trim() !== '' ? r.subject : null,
            body: r.body && r.body.trim() !== '' ? r.body : null,
            waTemplateId: r.waTemplateId ? waIds.get(r.waTemplateId)! : null,
            libraryTemplateId: libraryId,
            // Buttons belong on a reminder before the start; they mean nothing on the other steps.
            buttonsEnabled: r.buttonsEnabled && r.kind === 'before',
            skipIfConfirmed: r.skipIfConfirmed && r.kind === 'before',
            undeliveredFallbackMinutes: r.undeliveredFallbackMinutes ?? null,
            serviceLabel:
              r.serviceLabel && r.serviceLabel.trim() !== '' ? r.serviceLabel.trim() : null,
            packKey: r.packKey ?? null,
            packVersion: r.packKey ? (r.packVersion ?? 1) : null,
          };
        }),
      );
      touched.push('reminders');
    }
    if (input.templates !== undefined) {
      const keys = input.templates.map((t) => `${t.event}:${t.channel}`);
      if (new Set(keys).size !== keys.length) {
        throw AppError.validation('Two messages name the same event and channel.', [
          { path: 'templates', message: 'duplicate' },
        ]);
      }
      const wa = await this.repo.resolveWaTemplates(
        tx,
        orgId,
        input.templates.flatMap((t) => (t.waTemplateId ? [t.waTemplateId] : [])),
      );
      const chosen = await this.resolveLibraryChoices(tx, orgId, typeId, input.templates);
      await this.repo.replaceTemplates(
        tx,
        orgId,
        typeId,
        input.templates.map((t, i) => {
          if (t.waTemplateId && !wa.has(t.waTemplateId)) {
            throw AppError.validation('That WhatsApp template does not exist in this workspace.', [
              { path: `templates.${i}.waTemplateId`, message: t.waTemplateId },
            ]);
          }
          return {
            event: t.event,
            channel: t.channel,
            waTemplateId:
              chosen.get(i)?.waTemplateId ?? (t.waTemplateId ? wa.get(t.waTemplateId)! : null),
            plainBody: t.plainBody && t.plainBody.trim() !== '' ? t.plainBody : null,
            variableMap: t.variableMap ?? null,
            libraryTemplateId: chosen.get(i)?.id ?? null,
          };
        }),
      );
      touched.push('templates');
    }
    if (input.payment !== undefined || fresh) {
      const p = input.payment;
      if (p || fresh) {
        const org = await this.repo.org(tx, orgId);
        // The workspace's own currency seeds a price row that names none (Reference).
        const currency = p?.currency ?? org.currency ?? 'USD';
        const money = priceInMinor({
          currency,
          fee: p?.fee ?? '0',
          taxPercent: p?.taxPercent ?? '0',
          depositMode: p?.depositMode ?? 'none',
          deposit: p?.deposit ?? '0',
          cancelFee: p?.cancelFee ?? '0',
          noShowFee: p?.noShowFee ?? '0',
        });
        await this.repo.upsertFinancial(tx, orgId, typeId, {
          feeMinor: money.feeMinor,
          taxPct: p?.taxPercent ?? '0',
          currency,
          gatewaySlug: p?.gatewaySlug ?? null,
          depositMode: p?.depositMode ?? 'none',
          depositValueMinor: money.depositMinor,
          autoSendLink: p?.autoSendLink ?? true,
          cancelFeeMinor: money.cancelFeeMinor,
          noShowFeeMinor: money.noShowFeeMinor,
          cancelWindowMinutes: p?.cancelWindowMinutes ?? 1440,
        });
        if (p) touched.push('payment');
      }
    }
    if (input.calendar !== undefined || fresh) {
      const c = input.calendar;
      await this.repo.upsertIntegration(tx, orgId, typeId, {
        calendarId: c?.calendarId ?? null,
        // A virtual service gets a video link unless told otherwise (Reference).
        createMeet: c?.createMeet ?? locationType === 'virtual',
        spreadsheetId: c?.spreadsheetId ?? null,
        sheetRange: c?.sheetRange ?? 'Sheet1!A1',
      });
      if (c) touched.push('calendar');
    }
    return touched;
  }

  /** Slug made unique per workspace by a numeric suffix (Reference's rule). */
  /**
   * The library messages a type chooses for its lifecycle messages (BL-351): they must exist, be of the same kind and channel, be
   * active and, for WhatsApp, APPROVED (a choice the type already had is not asked again, so a type keeps saving after Meta pauses a
   * template; the sender skips an unapproved template at send time). A channel the type did not use before must be switched on.
   */
  private async resolveLibraryChoices(
    tx: Tx,
    orgId: number,
    typeId: number,
    list: NonNullable<UpdateBookingTypeInput['templates']>,
  ): Promise<Map<number, { id: number; waTemplateId: number | null }>> {
    const existing = (await this.repo.children(tx, orgId, [typeId])).get(typeId)!.templates;
    const had = (event: string, channel: string) =>
      existing.find((e) => e.event === event && e.channel === channel);
    const added: Array<{ channel: string; path: string }> = [];
    list.forEach((t, i) => {
      if (!had(t.event, t.channel))
        added.push({ channel: t.channel, path: `templates.${i}.channel` });
    });
    await this.channels.assertEnabled(
      tx,
      orgId,
      added.filter(
        (a) => a.channel === 'whatsapp' || a.channel === 'email' || a.channel === 'voice',
      ),
    );

    const rows = await this.library.findLibraryMany(
      tx,
      orgId,
      list.flatMap((t) => (t.libraryTemplateId ? [t.libraryTemplateId] : [])),
    );
    const out = new Map<number, { id: number; waTemplateId: number | null }>();
    list.forEach((t, i) => {
      if (!t.libraryTemplateId) return;
      const path = `templates.${i}.libraryTemplateId`;
      const row = rows.find((r) => r.uuid === t.libraryTemplateId);
      if (!row)
        throw AppError.validation('That message is not in the library of this workspace.', [
          { path, message: t.libraryTemplateId },
        ]);
      if (row.kind !== t.event || row.channel !== t.channel) {
        throw AppError.validation(
          'That message is for another kind of message or another channel.',
          [{ path, message: `${row.kind}/${row.channel}` }],
        );
      }
      const unchanged = had(t.event, t.channel)?.libraryTemplateId === row.id;
      if (!unchanged) {
        if (!row.isActive) {
          throw AppError.validation('That message is switched off in the library.', [
            { path, message: 'inactive' },
          ]);
        }
        if (toApiTemplate(row).status !== 'approved') {
          throw new AppError(
            ERROR_CODES.APPT_TEMPLATE_NOT_APPROVED,
            'Only an approved WhatsApp message can be chosen.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path, message: t.libraryTemplateId }],
          );
        }
      }
      out.set(i, { id: row.id, waTemplateId: row.waTemplateId });
    });
    return out;
  }

  private async uniqueSlug(
    tx: Tx,
    orgId: number,
    base: string,
    exceptId?: number,
  ): Promise<string> {
    const root = slugify(base);
    let slug = root;
    for (let n = 2; n < MAX_SLUG_TRIES + 2; n++) {
      if (!(await this.repo.slugTaken(tx, orgId, slug, exceptId))) return slug;
      slug = `${root}-${n}`.slice(0, 120);
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  private async resolveHost(
    tx: Tx,
    orgId: number,
    uuid: string | null | undefined,
    fallback: number | null,
  ): Promise<number | null> {
    if (uuid === undefined) return fallback;
    if (uuid === null) return null;
    const user = await this.repo.resolveActiveUser(tx, orgId, uuid);
    if (!user) {
      throw new AppError(
        ERROR_CODES.APPT_HOST_INVALID,
        'The host must be an active member of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'hostId', message: uuid }],
      );
    }
    return user.id;
  }

  private async typeContext(tx: Tx, orgId: number): Promise<TypeContext> {
    const org = await this.repo.org(tx, orgId);
    return {
      orgSlug: org.slug,
      webUrl: this.webUrl,
      orgTimezone: resolveZone(org.timezone),
      orgCurrency: org.currency,
    };
  }

  private async read(tx: Tx, orgId: number, uuid: string): Promise<BookingTypeResponse> {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Booking type', uuid);
    return this.respond(tx, orgId, row);
  }

  private async respond(tx: Tx, orgId: number, row: BookingTypeRow): Promise<BookingTypeResponse> {
    const children: TypeChildren = (await this.repo.children(tx, orgId, [row.id])).get(row.id)!;
    return toBookingTypeResponse(row, children, await this.typeContext(tx, orgId));
  }

  private async record(
    tx: Tx,
    orgId: number,
    row: BookingTypeRow,
    action: 'insert' | 'update' | 'delete',
    delta: Record<string, { old: unknown; new: unknown }> | undefined,
    eventType: string,
  ): Promise<void> {
    await this.audit.record(tx, { module: BOOKING_TYPE_MODULE, recordId: row.id, action, delta });
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: BOOKING_TYPE_MODULE,
      aggregateId: row.id,
      eventType,
      payload: { uuid: row.uuid, name: row.name, slug: row.slug, isActive: row.isActive },
    });
  }
}
