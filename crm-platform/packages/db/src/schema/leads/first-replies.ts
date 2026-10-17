/**
 * lead_first_replies: the automatic first message to a new lead (BL-014 speed-to-lead), one row per lead event and at the same time the
 * worker's queue. Mirrors migrations/20261220090000_lead_first_replies.sql; the SQL migration is the source of truth.
 */
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations } from '../foundation';
import { leadEvents } from './tables';

export const leadFirstReplies = pgTable(
  'lead_first_replies',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    leadEventId: idColumn('lead_event_id').notNull(),
    contactId: idColumn('contact_id'),
    channel: text('channel').notNull(),
    status: text('status').notNull().default('scheduled'),
    /** A stable code (`quiet_hours`, `no_consent`, ...), never provider text. */
    reason: text('reason'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_lead_first_replies_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'lead_first_replies_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_lead_first_replies_lead_event').on(t.orgId, t.leadEventId),
    check('chk_lead_first_replies_channel', sql`${t.channel} in ('whatsapp', 'sms', 'email')`),
    check(
      'chk_lead_first_replies_status',
      sql`${t.status} in ('scheduled', 'sending', 'held', 'sent', 'blocked', 'skipped', 'failed')`,
    ),
    foreignKey({
      name: 'fk_lead_first_replies_lead_event',
      columns: [t.orgId, t.leadEventId],
      foreignColumns: [leadEvents.orgId, leadEvents.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_lead_first_replies_contact',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    index('idx_lead_first_replies_due')
      .on(t.dueAt)
      .where(sql`${t.status} in ('scheduled', 'held', 'sending')`),
    index('idx_lead_first_replies_contact')
      .on(t.orgId, t.contactId)
      .where(sql`${t.contactId} is not null`),
  ],
);

export type LeadFirstRepliesRow = typeof leadFirstReplies.$inferSelect;
export type NewLeadFirstRepliesRow = typeof leadFirstReplies.$inferInsert;

