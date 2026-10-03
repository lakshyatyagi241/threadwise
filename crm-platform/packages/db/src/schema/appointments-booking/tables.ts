/**
 * appointments-booking: tables ported from WaDesk. Mirrors migrations/20261001104800_appt_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { conversations } from '../chat-conversations/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { coupons } from '../coupons-credits-referral-currency/tables';
import { contacts } from '../crm';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';
import { orders } from '../platform-payment-gateways/tables';

export const bookingTypes = pgTable(
  'booking_types',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    locationType: text('location_type').notNull().default('address'),
    locationValue: text('location_value'),
    color: text('color'),
    durationMinutes: smallint('duration_minutes').notNull().default(30),
    incrementMinutes: smallint('increment_minutes').notNull().default(30),
    bufferBeforeMinutes: smallint('buffer_before_minutes').notNull().default(0),
    bufferAfterMinutes: smallint('buffer_after_minutes').notNull().default(0),
    minNoticeMinutes: integer('min_notice_minutes').notNull().default(240),
    maxAdvanceDays: smallint('max_advance_days').notNull().default(30),
    maxPerDay: smallint('max_per_day'),
    capacity: smallint('capacity').notNull().default(1),
    timezone: text('timezone'),
    introMessage: text('intro_message'),
    approvalRequired: boolean('approval_required').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    meta: jsonb('meta'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_booking_types_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_booking_types_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_booking_types_location_type',
      sql`${t.locationType} in ('address', 'virtual', 'phone', 'whatsapp')`,
    ),
    unique('uq_booking_types_slug').on(t.orgId, t.slug),
    foreignKey({
      name: 'fk_booking_types_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_booking_types_is_active').on(t.orgId, t.isActive),
    index('idx_booking_types_sort').on(t.orgId, t.sortOrder, t.id),
  ],
);

export type BookingTypesRow = typeof bookingTypes.$inferSelect;
export type NewBookingTypesRow = typeof bookingTypes.$inferInsert;

export const slotReservations = pgTable(
  'slot_reservations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    sessionRef: text('session_ref').notNull(),
    channel: text('channel').notNull(),
    seats: smallint('seats').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_slot_reservations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_slot_reservations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_slot_reservations_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
    index('idx_slot_reservations_booking_type_id_starts_at').on(
      t.orgId,
      t.bookingTypeId,
      t.startsAt,
    ),
    index('idx_slot_reservations_expires_at').on(t.orgId, t.expiresAt),
  ],
);

export type SlotReservationsRow = typeof slotReservations.$inferSelect;
export type NewSlotReservationsRow = typeof slotReservations.$inferInsert;

export const appointments = pgTable(
  'appointments',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id'),
    provider: text('provider').notNull().default('baileys'),
    userId: idColumn('user_id'),
    contactId: idColumn('contact_id'),
    conversationId: idColumn('conversation_id'),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    inviteeTimezone: text('invitee_timezone'),
    status: text('status').notNull().default('pending'),
    paymentStatus: text('payment_status').notNull().default('none'),
    depositPaidMinor: bigint('deposit_paid_minor', { mode: 'number' }).notNull().default(0),
    orderId: idColumn('order_id'),
    calendarEventId: text('calendar_event_id'),
    calendarId: text('calendar_id'),
    meetUrl: text('meet_url'),
    inviteeName: text('invitee_name'),
    inviteeEmail: text('invitee_email'),
    inviteePhone: text('invitee_phone'),
    notes: text('notes'),
    manageTokenHash: text('manage_token_hash'),
    manageTokenCipher: text('manage_token_cipher'),
    seat: smallint('seat').notNull().default(1),
    armedAt: timestamp('armed_at', { withTimezone: true }).notNull().defaultNow(),
    needsReview: boolean('needs_review').notNull().default(false),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    cancelReason: text('cancel_reason'),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency'),
    dueNowMinor: bigint('due_now_minor', { mode: 'number' }).notNull().default(0),
    feeRecordedMinor: bigint('fee_recorded_minor', { mode: 'number' }).notNull().default(0),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    meta: jsonb('meta'),
    answers: jsonb('answers'),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    source: text('source').notNull().default('chat'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_appointments_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_appointments_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_appointments_payment_status',
      sql`${t.paymentStatus} in ('none', 'pending', 'paid', 'partial', 'refunded')`,
    ),
    check('chk_appointments_source', sql`${t.source} in ('chat', 'link', 'manual', 'api')`),
    check(
      'chk_appointments_status',
      sql`${t.status} in ('pending', 'confirmed', 'cancelled', 'declined', 'completed', 'no_show')`,
    ),
    unique('uq_appointments_manage_token_hash').on(t.manageTokenHash),
    foreignKey({
      name: 'fk_appointments_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_appointments_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_appointments_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_appointments_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_appointments_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_appointments_order_id',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }).onDelete('set null'),
    index('idx_appointments_contact_id').on(t.orgId, t.contactId),
    index('idx_appointments_conversation_id').on(t.orgId, t.conversationId),
    index('idx_appointments_calendar_event_id').on(t.orgId, t.calendarEventId),
    index('idx_appointments_order_id').on(t.orgId, t.orderId),
    index('idx_appointments_user_id').on(t.orgId, t.userId),
    index('idx_appointments_created_by').on(t.orgId, t.createdBy),
    index('idx_appointments_status_starts').on(t.orgId, t.status, t.startsAt, t.id),
    index('idx_appointments_starts_id').on(t.orgId, t.startsAt, t.id),
    index('idx_appointments_confirmed_starts').on(t.startsAt),
    index('idx_appointments_hold_expiry').on(t.holdExpiresAt),
    index('idx_appointments_pending_ends').on(t.endsAt),
    index('idx_appointments_booking_type_id_starts_at').on(t.orgId, t.bookingTypeId, t.startsAt),
    index('idx_appointments_starts_at').on(t.orgId, t.startsAt),
    index('idx_appointments_status').on(t.orgId, t.status),
    index('idx_appointments_provider').on(t.orgId, t.provider),
  ],
);

export type AppointmentsRow = typeof appointments.$inferSelect;
export type NewAppointmentsRow = typeof appointments.$inferInsert;

export const bookingAvailabilityOverrides = pgTable(
  'booking_availability_overrides',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id').notNull(),
    date: date('date').notNull(),
    isClosed: boolean('is_closed').notNull().default(false),
    startTime: time('start_time'),
    endTime: time('end_time'),
    reason: text('reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_booking_availability_overrides_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_booking_availability_overrides_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_booking_availability_overrides_booking_type_id_date').on(
      t.orgId,
      t.bookingTypeId,
      t.date,
    ),
    foreignKey({
      name: 'fk_booking_availability_overrides_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
  ],
);

export type BookingAvailabilityOverridesRow = typeof bookingAvailabilityOverrides.$inferSelect;
export type NewBookingAvailabilityOverridesRow = typeof bookingAvailabilityOverrides.$inferInsert;

export const bookingAvailabilityRules = pgTable(
  'booking_availability_rules',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_booking_availability_rules_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_booking_availability_rules_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_booking_availability_rules_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
    index('idx_booking_availability_rules_booking_type_id_weekday').on(
      t.orgId,
      t.bookingTypeId,
      t.weekday,
    ),
  ],
);

export type BookingAvailabilityRulesRow = typeof bookingAvailabilityRules.$inferSelect;
export type NewBookingAvailabilityRulesRow = typeof bookingAvailabilityRules.$inferInsert;

export const bookingFinancials = pgTable(
  'booking_financials',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id').notNull(),
    feeMinor: bigint('fee_minor', { mode: 'number' }).notNull().default(0),
    taxPct: numeric('tax_pct', { precision: 5, scale: 2 }).notNull().default('0.00'),
    currency: text('currency'),
    gatewaySlug: text('gateway_slug'),
    depositMode: text('deposit_mode').notNull().default('none'),
    depositValueMinor: bigint('deposit_value_minor', { mode: 'number' }).notNull().default(0),
    autoSendLink: boolean('auto_send_link').notNull().default(true),
    cancelFeeMinor: bigint('cancel_fee_minor', { mode: 'number' }).notNull().default(0),
    noShowFeeMinor: bigint('no_show_fee_minor', { mode: 'number' }).notNull().default(0),
    cancelWindowMinutes: integer('cancel_window_minutes').notNull().default(1440),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_booking_financials_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_booking_financials_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_booking_financials_deposit_mode',
      sql`${t.depositMode} in ('none', 'partial', 'full')`,
    ),
    unique('uq_booking_financials_booking_type_id').on(t.orgId, t.bookingTypeId),
    foreignKey({
      name: 'fk_booking_financials_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
  ],
);

export type BookingFinancialsRow = typeof bookingFinancials.$inferSelect;
export type NewBookingFinancialsRow = typeof bookingFinancials.$inferInsert;

export const bookingIntegrations = pgTable(
  'booking_integrations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id').notNull(),
    calendarId: text('calendar_id'),
    createMeet: boolean('create_meet').notNull().default(false),
    spreadsheetId: text('spreadsheet_id'),
    sheetRange: text('sheet_range').notNull().default('Sheet1!A1'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_booking_integrations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_booking_integrations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_booking_integrations_booking_type_id').on(t.orgId, t.bookingTypeId),
    foreignKey({
      name: 'fk_booking_integrations_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
  ],
);

export type BookingIntegrationsRow = typeof bookingIntegrations.$inferSelect;
export type NewBookingIntegrationsRow = typeof bookingIntegrations.$inferInsert;

export const bookingQuestions = pgTable(
  'booking_questions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    options: jsonb('options'),
    required: boolean('required').notNull().default(true),
    mapToContactField: text('map_to_contact_field'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_booking_questions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_booking_questions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_booking_questions_type',
      sql`${t.type} in ('text', 'textarea', 'select', 'number', 'email', 'phone', 'date')`,
    ),
    foreignKey({
      name: 'fk_booking_questions_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
    index('idx_booking_questions_booking_type_id').on(t.orgId, t.bookingTypeId),
  ],
);

export type BookingQuestionsRow = typeof bookingQuestions.$inferSelect;
export type NewBookingQuestionsRow = typeof bookingQuestions.$inferInsert;

export const bookingReminders = pgTable(
  'booking_reminders',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id').notNull(),
    offsetIndex: smallint('offset_index').notNull(),
    offsetMinutes: integer('offset_minutes').notNull(),
    templateEvent: text('template_event').notNull().default('reminder'),
    label: text('label'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_booking_reminders_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_booking_reminders_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_booking_reminders_booking_type_id_offset_index').on(
      t.orgId,
      t.bookingTypeId,
      t.offsetIndex,
    ),
    unique('uq_booking_reminders_booking_type_id_offset_minutes').on(
      t.orgId,
      t.bookingTypeId,
      t.offsetMinutes,
    ),
    foreignKey({
      name: 'fk_booking_reminders_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
    index('idx_booking_reminders_booking_type_id_is_active').on(
      t.orgId,
      t.bookingTypeId,
      t.isActive,
    ),
  ],
);

export type BookingRemindersRow = typeof bookingReminders.$inferSelect;
export type NewBookingRemindersRow = typeof bookingReminders.$inferInsert;

export const bookingTemplates = pgTable(
  'booking_templates',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id').notNull(),
    event: text('event').notNull(),
    channel: text('channel').notNull().default('whatsapp'),
    waTemplateId: idColumn('wa_template_id'),
    plainBody: text('plain_body'),
    variableMap: jsonb('variable_map'),
    couponCode: text('coupon_code'),
    couponId: idColumn('coupon_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_booking_templates_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_booking_templates_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_booking_templates_event',
      sql`${t.event} in ('confirmation', 'cancellation', 'reminder', 'reschedule')`,
    ),
    check(
      'chk_booking_templates_channel',
      sql`${t.channel} in ('whatsapp', 'email', 'telegram', 'instagram', 'facebook')`,
    ),
    unique('uq_booking_templates_booking_type_id_event_channel').on(
      t.orgId,
      t.bookingTypeId,
      t.event,
      t.channel,
    ),
    foreignKey({
      name: 'fk_booking_templates_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_booking_templates_wa_template_id',
      columns: [t.orgId, t.waTemplateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_booking_templates_coupon_id',
      columns: [t.couponId],
      foreignColumns: [coupons.id],
    }).onDelete('set null'),
    index('idx_booking_templates_coupon_id').on(t.orgId, t.couponId),
    index('idx_booking_templates_wa_template_id').on(t.orgId, t.waTemplateId),
  ],
);

export type BookingTemplatesRow = typeof bookingTemplates.$inferSelect;
export type NewBookingTemplatesRow = typeof bookingTemplates.$inferInsert;

export const appointmentReminderRuns = pgTable(
  'appointment_reminder_runs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    appointmentId: idColumn('appointment_id').notNull(),
    reminderId: idColumn('reminder_id'),
    offsetMinutes: integer('offset_minutes').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    foreignKey({
      name: 'fk_appointment_reminder_runs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_appointment_reminder_runs').on(t.orgId, t.appointmentId, t.offsetMinutes),
    foreignKey({
      name: 'fk_appointment_reminder_runs_appointment',
      columns: [t.orgId, t.appointmentId],
      foreignColumns: [appointments.orgId, appointments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_appointment_reminder_runs_reminder',
      columns: [t.orgId, t.reminderId],
      foreignColumns: [bookingReminders.orgId, bookingReminders.id],
    }).onDelete('set null'),
    index('idx_appointment_reminder_runs_appointment').on(t.orgId, t.appointmentId),
  ],
);

export type AppointmentReminderRunsRow = typeof appointmentReminderRuns.$inferSelect;
export type NewAppointmentReminderRunsRow = typeof appointmentReminderRuns.$inferInsert;

/**
 * The workspace's connected Google Calendar (WD-APPT-028, 029). Mirrors migrations/20261019110000_appt_google_calendar.sql: one row per
 * workspace, tokens sealed with the credentials key.
 */
export const appointmentCalendarConnections = pgTable(
  'appointment_calendar_connections',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    provider: text('provider').notNull().default('google'),
    connectedBy: idColumn('connected_by'),
    accountEmail: text('account_email'),
    accountSub: text('account_sub'),
    /** AES-GCM ciphertext (credentials key); never plain text. */
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    /** The cached short-lived access token, same sealing. */
    accessTokenEnc: text('access_token_enc'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    scopes: text('scopes'),
    calendarId: text('calendar_id').notNull().default('primary'),
    calendarName: text('calendar_name'),
    status: text('status').notNull().default('active'),
    statusReason: text('status_reason'),
    statusAt: timestamp('status_at', { withTimezone: true }).notNull().defaultNow(),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_appointment_calendar_connections_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_appointment_calendar_connections_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_appointment_calendar_connections_org').on(t.orgId),
    check('chk_appointment_calendar_connections_provider', sql`${t.provider} in ('google')`),
    check(
      'chk_appointment_calendar_connections_status',
      sql`${t.status} in ('active', 'needs_reconnect')`,
    ),
    foreignKey({
      name: 'fk_appointment_calendar_connections_connected_by',
      columns: [t.orgId, t.connectedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_appointment_calendar_connections_connected_by').on(t.orgId, t.connectedBy),
  ],
);

export type AppointmentCalendarConnectionsRow = typeof appointmentCalendarConnections.$inferSelect;
export type NewAppointmentCalendarConnectionsRow =
  typeof appointmentCalendarConnections.$inferInsert;
