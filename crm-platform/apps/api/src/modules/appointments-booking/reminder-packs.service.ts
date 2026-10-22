import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  BOOKING_TIMED_STEPS_MAX,
  ERROR_CODES,
  BOOKING_UNDELIVERED_DEFAULT,
  type BookingReminderChannel,
  type BookingReminderInput,
  type BookingReminderStepKind,
  type ReminderPack,
  type ReminderPackAdoptInput,
  type ReminderPackAdoptResult,
  type ReminderPackLanguage,
  type ReminderPackPreview,
  type ReminderPackPreviewInput,
  type ReminderPackWithheld,
  type ReminderPackPreviewStep,
  type ReminderPacksResponse,
  type AppointmentMessageKind,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ReminderPlan } from './reminder-plan';
import { AppointmentChannelsRepository } from './appointment-channels.repository';
import { AppointmentTemplatesService } from './appointment-templates.service';
import { BookingTypesRepository, type ReminderRow } from './booking-types.repository';
import { BookingTypesService } from './booking-types.service';
import {
  PACKS,
  PACKS_VERSION,
  PACK_BUTTONS,
  libraryKeyOf,
  packByKey,
  waTemplateNameOf,
  type PackData,
  type PackStepData,
} from './reminder-packs.data';

/** A step's name in the message library. */
const STEP_LABEL: Record<BookingReminderStepKind, string> = {
  confirmation: 'Confirmation',
  reminder_24h: '24 hour reminder',
  reminder_2h: '2 hour reminder',
  reminder_15m: '15 minute reminder',
  reminder: 'Reminder',
  after_visit: 'After the visit',
  no_show: 'No-show',
  rebook: 'Rebook',
};

const MESSAGE_KIND: Record<BookingReminderStepKind, AppointmentMessageKind> = {
  confirmation: 'confirmation',
  reminder_24h: 'reminder',
  reminder_2h: 'reminder',
  reminder_15m: 'reminder',
  reminder: 'reminder',
  after_visit: 'follow_up',
  no_show: 'no_show',
  rebook: 'rebook',
};

const MACHINE_DRAFTED: ReminderPackLanguage[] = ['hi'];

/** The pack as the wire carries it. */
export function toApiPack(p: PackData): ReminderPack {
  return {
    key: p.key,
    version: PACKS_VERSION,
    name: p.name,
    description: p.description,
    languages: ['en', 'hi'],
    machineDrafted: MACHINE_DRAFTED,
    steps: p.steps.map((s) => ({
      stepKind: s.stepKind,
      kind: s.kind,
      offsetMinutes: s.offsetMinutes,
      isActive: s.isActive,
      channels: ['whatsapp', 'email'] as BookingReminderChannel[],
      buttons: s.buttons,
      skipIfConfirmed: s.skipIfConfirmed,
      onlineOnly: s.onlineOnly,
      metaCategory: s.category,
      messageKind: MESSAGE_KIND[s.stepKind],
    })),
  };
}

/** Whether a pack step is a timed one (counts against the cap of five). */
const isTimed = (s: { kind: string }): boolean => s.kind !== 'event';

/**
 * Applying a step of a pack to a type that already has a rule for that step: nothing when it already is that pack's step at this
 * version, otherwise a replace (the owner confirms it first).
 */
export function actionFor(
  existing: Pick<ReminderRow, 'packKey' | 'packVersion' | 'offsetMinutes'> | undefined,
  pack: PackData,
  step: PackStepData,
): 'add' | 'replace' | 'unchanged' {
  if (!existing) return 'add';
  return existing.packKey === pack.key &&
    existing.packVersion === PACKS_VERSION &&
    existing.offsetMinutes === step.offsetMinutes
    ? 'unchanged'
    : 'replace';
}

/**
 * Reminder packs (BL-424): seven predefined sequences with their messages in English and Hindi. A preview shows what applying a pack to
 * a booking type would add and replace, and nothing is overwritten until the owner confirms. Adopting makes, once per workspace, an
 * email message in the library for every step (active at once) and a WhatsApp template for every step, named
 * `appt_<pack>_<step>_<lang>`, created as a draft and sent to Meta through the template library (its status is read live; until it is
 * approved the step falls back to email). The type's steps are then saved through the booking type's own update, so every rule of the
 * editor applies (channels switched on, the plan features, the cap of five timed steps).
 */
@Injectable()
export class ReminderPacksService {
  private readonly logger = new Logger(ReminderPacksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly types: BookingTypesRepository,
    private readonly typesService: BookingTypesService,
    private readonly templates: AppointmentTemplatesService,
    private readonly channels: AppointmentChannelsRepository,
    private readonly plan: ReminderPlan,
  ) {}

  list(): ReminderPacksResponse {
    return { data: PACKS.map(toApiPack) };
  }

  async preview(key: string, input: ReminderPackPreviewInput): Promise<ReminderPackPreview> {
    const pack = this.pack(key);
    const load = await this.loadType(input.bookingTypeId);
    const steps: ReminderPackPreviewStep[] = [];
    for (const s of pack.steps) {
      const existing = load.reminders.find((r) => r.stepKind === s.stepKind);
      const text = s.text[input.language];
      const waName = waTemplateNameOf(pack.key, s.stepKind, input.language);
      const waStatus = await this.templates.waStatusByName(waName, input.language);
      steps.push({
        step: toApiPack({ ...pack, steps: [s] }).steps[0]!,
        action: actionFor(existing, pack, s),
        existing: existing
          ? {
              id: existing.uuid,
              isActive: existing.isActive,
              offsetMinutes: existing.offsetMinutes,
              hasOwnText:
                !!existing.body || !!existing.subject || existing.libraryTemplateId !== null,
            }
          : null,
        email: { subject: text.subject, body: text.email },
        whatsapp: {
          templateName: waName,
          body: text.wa,
          status: waStatus ?? 'new',
          buttons: s.buttons ? [...PACK_BUTTONS[input.language]] : [],
        },
      });
    }
    const parts = await this.plan.parts(RequestContextStore.require().orgId);
    const withheld: ReminderPackWithheld[] = pack.steps.flatMap((s) => [
      ...(s.buttons && !parts.buttons ? [{ stepKind: s.stepKind, part: 'buttons' as const }] : []),
      ...(s.stepKind === 'rebook' && !parts.rebook
        ? [{ stepKind: s.stepKind, part: 'rebook' as const }]
        : []),
    ]);
    const packSteps = new Set(pack.steps.map((s) => s.stepKind));
    const keptRows = load.reminders.filter((r) => !packSteps.has(r.stepKind));
    const timed = keptRows.filter(isTimed).length + pack.steps.filter(isTimed).length;
    return {
      pack: toApiPack(pack),
      language: input.language,
      bookingType: { id: load.uuid, name: load.name, online: load.online },
      steps,
      kept: keptRows.map((r) => ({
        id: r.uuid,
        stepKind: r.stepKind,
        offsetMinutes: r.offsetMinutes,
      })),
      timedSteps: timed,
      timedStepsMax: BOOKING_TIMED_STEPS_MAX,
      blocked: timed > BOOKING_TIMED_STEPS_MAX ? 'cap_exceeded' : null,
      needsConfirm: steps.some((s) => s.action === 'replace'),
      withheld,
    };
  }

  async adopt(key: string, input: ReminderPackAdoptInput): Promise<ReminderPackAdoptResult> {
    const pack = this.pack(key);
    const ctx = RequestContextStore.require();
    const view = await this.preview(key, {
      bookingTypeId: input.bookingTypeId,
      language: input.language,
    });
    if (view.blocked) {
      throw AppError.validation(
        `A service can have at most ${BOOKING_TIMED_STEPS_MAX} steps with a time. Remove one first, then apply the pack.`,
        [{ path: 'bookingTypeId', message: 'cap_exceeded' }],
      );
    }
    if (view.needsConfirm && !input.confirmReplace) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Applying this pack would replace steps this service already has. Review the preview and confirm.',
        HttpStatus.CONFLICT,
        view.steps
          .filter((s) => s.action === 'replace')
          .map((s) => ({ path: s.step.stepKind, message: 'replace' })),
      );
    }

    const lang = input.language;
    const load = await this.loadType(input.bookingTypeId);
    const enabled = await this.db.tx(async (tx) => {
      const rows = await this.channels.settings(tx, ctx.orgId);
      return new Set(rows.filter((r) => r.enabled).map((r) => r.channel));
    });
    const { buttons: hasButtonsPlan, rebook: hasRebookPlan } = await this.plan.parts(ctx.orgId);
    const waReady = await this.templates.hasWhatsappConnection();

    const made: ReminderPackAdoptResult['templates'] = [];
    const inputs = new Map<BookingReminderStepKind, BookingReminderInput>();
    let added = 0;
    let replaced = 0;

    for (const s of pack.steps) {
      const text = s.text[lang];
      const label = STEP_LABEL[s.stepKind];
      const email = await this.templates.ensurePackEmail({
        key: libraryKeyOf(pack.key, s.stepKind),
        kind: MESSAGE_KIND[s.stepKind],
        language: lang,
        name: `${pack.name}: ${label}`,
        subject: text.subject,
        body: text.email,
      });

      let waUuid: string | null = null;
      const templateName = waTemplateNameOf(pack.key, s.stepKind, lang);
      if (waReady) {
        try {
          const wa = await this.templates.ensurePackWhatsapp({
            key: libraryKeyOf(pack.key, s.stepKind),
            kind: MESSAGE_KIND[s.stepKind],
            language: lang,
            name: `${pack.name}: ${label}`,
            templateName,
            body: text.wa,
            category: s.category,
            buttons: s.buttons && hasButtonsPlan ? [...PACK_BUTTONS[lang]] : [],
            submit: input.submitToMeta,
          });
          waUuid = wa.waUuid;
          const status = await this.templates.waStatusByName(templateName, lang);
          made.push({
            name: templateName,
            status: status ?? 'draft',
            created: wa.created,
            metaError: wa.metaError,
          });
        } catch (err) {
          // A template Meta's rules or the plan refuse leaves the step on email; the sentence is told to the owner.
          this.logger.warn(
            {
              orgId: ctx.orgId,
              templateName,
              err: err instanceof Error ? err.message : String(err),
            },
            'a reminder pack template could not be created',
          );
          made.push({
            name: templateName,
            status: 'draft',
            created: false,
            metaError: err instanceof AppError ? err.message : 'The template could not be created.',
          });
        }
      }

      const usable = (['whatsapp', 'email'] as const).filter((c) => enabled.has(c));
      const wantsOn = s.isActive && (s.stepKind !== 'rebook' || hasRebookPlan);
      const existing = load.reminders.find((r) => r.stepKind === s.stepKind);
      if (existing) replaced += 1;
      else added += 1;
      inputs.set(s.stepKind, {
        ...(existing ? { id: existing.uuid } : {}),
        offsetMinutes: s.offsetMinutes,
        label: null,
        isActive: wantsOn && usable.length > 0,
        kind: s.kind,
        stepKind: s.stepKind,
        channels: usable.length > 0 ? [...usable] : ['whatsapp', 'email'],
        subject: null,
        body: null,
        waTemplateId: waUuid,
        libraryTemplateId: email.uuid,
        buttonsEnabled: s.buttons && hasButtonsPlan && waUuid !== null,
        skipIfConfirmed: s.skipIfConfirmed,
        undeliveredFallbackMinutes: usable.includes('whatsapp')
          ? BOOKING_UNDELIVERED_DEFAULT
          : null,
        serviceLabel: pack.serviceLabel ? pack.serviceLabel[lang] : null,
        packKey: pack.key,
        packVersion: PACKS_VERSION,
      });
    }

    // The type's own steps that the pack does not touch stay exactly as they are.
    const keep: BookingReminderInput[] = load.reminders
      .filter((r) => !inputs.has(r.stepKind))
      .map((r) => ({
        id: r.uuid,
        offsetMinutes: r.offsetMinutes,
        label: r.label,
        isActive: r.isActive,
        kind: r.kind,
        stepKind: r.stepKind,
        channels: r.channels,
        subject: r.subject,
        body: r.body,
        waTemplateId: r.waTemplateUuid,
        libraryTemplateId: r.libraryTemplateUuid,
        buttonsEnabled: r.buttonsEnabled,
        skipIfConfirmed: r.skipIfConfirmed,
        undeliveredFallbackMinutes: r.undeliveredFallbackMinutes,
        serviceLabel: r.serviceLabel,
        packKey: r.packKey,
        packVersion: r.packVersion,
      }));

    const updated = await this.typesService.update(input.bookingTypeId, {
      reminders: [...keep, ...inputs.values()],
      rowVersion: load.rowVersion,
    });
    return {
      reminders: updated.reminders,
      templates: made,
      added,
      replaced,
      withheld: view.withheld,
    };
  }

  // --- helpers ------------------------------------------------------------------------------------------------------------------

  private pack(key: string): PackData {
    const p = packByKey(key);
    if (!p) throw AppError.notFound('Reminder pack', key);
    return p;
  }

  private async loadType(uuid: string): Promise<{
    uuid: string;
    name: string;
    online: boolean;
    rowVersion: number;
    reminders: ReminderRow[];
  }> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.types.findByUuid(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Booking type', uuid);
      const kids = (await this.types.children(tx, orgId, [row.id])).get(row.id);
      return {
        uuid: row.uuid,
        name: row.name,
        online: row.locationType === 'virtual',
        rowVersion: row.rowVersion,
        reminders: kids?.reminders ?? [],
      };
    });
  }
}
