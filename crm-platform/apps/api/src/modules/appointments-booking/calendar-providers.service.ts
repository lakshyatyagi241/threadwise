import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CalendarProvider } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import type { CalendarStatus, CalendarSyncPort } from '../../infra/providers/appointments-booking';
import { GoogleCalendarAdapter } from './google-calendar.adapter';
import { MicrosoftCalendarAdapter } from './microsoft-calendar.adapter';

/** How long a process keeps a workspace's choice before asking again (a change made in this process drops it at once). */
const PREFERENCE_TTL_MS = 10_000;

/** A provider adapter that can be told its cached view of a workspace is stale. */
export type ProviderAdapter = CalendarSyncPort & { forget(orgId: number): void };

/**
 * The calendar providers a workspace may have connected, and which of them bookings are written to (BL-035). Busy time is read from every
 * connected provider, but a booking's event goes to exactly ONE, so a booking never appears twice.
 *
 * Which one: an admin's explicit choice while that provider is usable (`appointment_calendar_preferences`); otherwise Google when it is
 * usable (what a workspace that only ever had Google already did), else Microsoft; null when none is usable.
 */
@Injectable()
export class CalendarProviders {
  private readonly preferences = new Map<
    number,
    { at: number; provider: CalendarProvider | null }
  >();

  constructor(
    private readonly db: DatabaseService,
    readonly google: GoogleCalendarAdapter,
    readonly microsoft: MicrosoftCalendarAdapter,
  ) {}

  adapter(provider: CalendarProvider): ProviderAdapter {
    return provider === 'google' ? this.google : this.microsoft;
  }

  async statuses(orgId: number): Promise<Record<CalendarProvider, CalendarStatus>> {
    const [google, microsoft] = await Promise.all([
      this.google.status(orgId),
      this.microsoft.status(orgId),
    ]);
    return { google, microsoft };
  }

  /** Providers whose grant is usable right now, Google first. */
  async connected(orgId: number): Promise<CalendarProvider[]> {
    const s = await this.statuses(orgId);
    return (['google', 'microsoft'] as const).filter((p) => s[p].connected);
  }

  async preference(orgId: number): Promise<CalendarProvider | null> {
    const hit = this.preferences.get(orgId);
    if (hit && Date.now() - hit.at < PREFERENCE_TTL_MS) return hit.provider;
    const provider = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.readPreference(tx, orgId),
    );
    this.preferences.set(orgId, { at: Date.now(), provider });
    return provider;
  }

  async readPreference(tx: Tx, orgId: number): Promise<CalendarProvider | null> {
    const res = await tx.execute(
      sql`SELECT provider FROM appointment_calendar_preferences WHERE org_id = ${orgId}`,
    );
    const row = (res.rows as Array<{ provider?: string }>)[0];
    return row?.provider === 'google' || row?.provider === 'microsoft' ? row.provider : null;
  }

  /**
   * Stores the choice (`null` goes back to automatic). Returns the row id (for the audit row) and what was stored before; the caller audits
   * and emits in the same transaction.
   */
  async writePreference(
    tx: Tx,
    orgId: number,
    userId: number | null,
    provider: CalendarProvider | null,
  ): Promise<{ id: number | null; previous: CalendarProvider | null }> {
    const before = await tx.execute(
      sql`SELECT id, provider FROM appointment_calendar_preferences WHERE org_id = ${orgId} FOR UPDATE`,
    );
    const was = (before.rows as Array<{ id?: number | string; provider?: string }>)[0];
    const previous =
      was?.provider === 'google' || was?.provider === 'microsoft' ? was.provider : null;
    if (provider === null) {
      await tx.execute(sql`DELETE FROM appointment_calendar_preferences WHERE org_id = ${orgId}`);
      return { id: was ? Number(was.id) : null, previous };
    }
    const res = await tx.execute(sql`
      INSERT INTO appointment_calendar_preferences (org_id, provider, updated_by)
      VALUES (${orgId}, ${provider}, ${userId})
      ON CONFLICT (org_id) DO UPDATE SET provider = EXCLUDED.provider, updated_by = EXCLUDED.updated_by
      RETURNING id`);
    return { id: Number((res.rows as Array<{ id: number | string }>)[0]!.id), previous };
  }

  forgetPreference(orgId: number): void {
    this.preferences.delete(orgId);
  }

  /** Where a booking's event is written now, or null when no connected provider is usable. */
  async writeProvider(orgId: number): Promise<CalendarProvider | null> {
    const [connected, preferred] = await Promise.all([
      this.connected(orgId),
      this.preference(orgId),
    ]);
    if (preferred && connected.includes(preferred)) return preferred;
    return connected[0] ?? null;
  }
}
