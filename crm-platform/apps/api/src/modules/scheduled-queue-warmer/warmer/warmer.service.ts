import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  WARMER_DEFAULTS,
  type WarmerList,
  type WarmerNumber,
  type WarmerProfileInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../../auth/unofficial-whatsapp.port';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import type { DispatchSender, ResolvedSender, WarmerGate } from '../../broadcasts';
import {
  dailyBudgetFor,
  gapSeconds,
  gateBatch,
  healthScore,
  profileOf,
  startedAtOf,
  withinActiveHours,
  type HoldReason,
  type WarmerProfile,
} from './warmer-rules';

/** The ledger and the profile read by one number, whatever its engine. */
interface NumberFacts {
  profile: WarmerProfile;
  startedAt: string | null;
  createdDay: string;
  status: string;
}

type Sender = Pick<ResolvedSender | DispatchSender, 'engine' | 'id'>;
/** A sender and how many recipients of one send go through it. */
export interface WarmerSlice {
  sender: ResolvedSender | DispatchSender;
  recipients: number;
}

const todayUtc = (now: Date) => now.toISOString().slice(0, 10);

const HOLD_TEXT: Record<
  HoldReason,
  (label: string, day: string, budget: number, left: number, n: number) => string
> = {
  outside_active_hours: (label) => `${label} is outside its warmer active hours right now.`,
  daily_budget_reached: (label, day) =>
    `Held by WhatsApp Warmer: ${label} is warming - its budget for ${day} is already reserved.`,
  budget_capped: (label, day, budget, left, n) =>
    `Held by WhatsApp Warmer: ${label} is warming - only ${left} of its ${budget}-message budget for ${day} remains, but this send has ${n} recipients. Reduce the audience or pick a later date. You can adjust these limits on the Warmer page.`,
};

/**
 * The number warmer (TW-SCHED-008, 036 to 040): each number may carry a ramping daily budget, a random gap between sends, active
 * hours and spintax, kept in its own `warmer_config`. It paces bulk sends (broadcasts, campaigns, scheduled messages) and never a
 * person answering a customer in the inbox. Enforcement is opt-in per number.
 *
 * It is the broadcast sender's `WarmerGate`: the broadcast and campaign dispatchers ask it for the gap between messages and whether
 * a launch fits today's budget. Reservations are counted in `warmer_daily_sends` by (engine, number, day) and, unlike Reference, can
 * be given back when a schedule that reserved them is cancelled, deleted or fails (`release`).
 *
 * Days are UTC dates (Reference used the owner's timezone; the platform has no per-person zone yet).
 */
@Injectable()
export class WarmerService implements WarmerGate {
  /** Replaceable in tests. */
  now: () => Date = () => new Date();
  random: () => number = Math.random;

  constructor(
    private readonly db: DatabaseService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  // --- the gate the dispatchers use ---------------------------------------------------------------

  async gap(tx: Tx, sender: Sender): Promise<{ min: number; max: number } | null> {
    const f = await this.facts(tx, sender);
    return f?.profile.enabled ? { min: f.profile.gapMin, max: f.profile.gapMax } : null;
  }

  /** Reasons a warming number must hold this send; empty means go. Passing slices are reserved, all or none. */
  async hold(
    tx: Tx,
    slices: readonly WarmerSlice[],
    opts: { isNow: boolean; sendDate: string | null },
  ): Promise<string[]> {
    const day = opts.isNow || !opts.sendDate ? todayUtc(this.now()) : opts.sendDate;
    const reasons: string[] = [];
    const reserve: Array<{ sender: Sender; n: number }> = [];
    for (const s of slices) {
      const f = await this.facts(tx, s.sender);
      if (!f?.profile.enabled) continue;
      const budget = dailyBudgetFor(f.profile, f.startedAt, f.createdDay, day);
      const used = await this.sentOn(tx, s.sender, day);
      const g = gateBatch(f.profile, {
        requested: s.recipients,
        budget,
        used,
        ...(opts.isNow ? { hour: this.now().getUTCHours() } : {}),
      });
      if (!g.ok && g.reason) {
        reasons.push(HOLD_TEXT[g.reason](s.sender.label, day, budget, g.remaining, s.recipients));
      } else if (s.recipients > 0) {
        reserve.push({ sender: s.sender, n: s.recipients });
      }
    }
    // A hold on any number refuses the whole send, so a partial reservation cannot happen.
    if (reasons.length === 0) for (const r of reserve) await this.reserve(tx, r.sender, day, r.n);
    return reasons;
  }

  // --- what the scheduled run applies to every message ---------------------------------------------

  /** Whether a warming number may send right now: its active hours. A number that is not warming always may. */
  async mayRunNow(tx: Tx, sender: Sender): Promise<boolean> {
    const f = await this.facts(tx, sender);
    return !f?.profile.enabled || withinActiveHours(f.profile, this.now().getUTCHours());
  }

  /** A random gap in seconds for a warming number, or null to use the platform pacing. */
  async nextGapSeconds(tx: Tx, sender: Sender): Promise<number | null> {
    const f = await this.facts(tx, sender);
    return f?.profile.enabled ? gapSeconds(f.profile, this.random) : null;
  }

  /** Whether this number is warming. Only then does a send count against its daily budget, so only then is there anything to give back. */
  async isWarming(tx: Tx, sender: Sender): Promise<boolean> {
    return Boolean((await this.facts(tx, sender))?.profile.enabled);
  }

  /** Whether this number varies its wording with spintax (`{a|b}`). */
  async spintaxOn(tx: Tx, sender: Sender): Promise<boolean> {
    const f = await this.facts(tx, sender);
    return Boolean(f?.profile.enabled && f.profile.spintax);
  }

  // --- the ledger ----------------------------------------------------------------------------------

  async sentOn(tx: Tx, sender: Sender, day: string): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count FROM warmer_daily_sends
       WHERE engine = ${sender.engine} AND device_id = ${sender.id} AND day = ${day}::date`);
    return Number((res.rows[0] as { count?: number | string } | undefined)?.count ?? 0);
  }

  /** Counts `n` sends against a day's budget (an atomic upsert on the unique row). */
  async reserve(tx: Tx, sender: Sender, day: string, n: number): Promise<void> {
    if (n <= 0) return;
    await tx.execute(sql`
      INSERT INTO warmer_daily_sends (org_id, engine, device_id, day, count)
      VALUES (current_org_id(), ${sender.engine}, ${sender.id}, ${day}::date, ${n})
      ON CONFLICT (org_id, engine, device_id, day) DO UPDATE SET count = warmer_daily_sends.count + ${n}`);
  }

  /** Gives back reserved sends that will not happen (a cancelled or deleted schedule), never below zero. */
  async release(tx: Tx, sender: Sender, day: string, n: number): Promise<void> {
    if (n <= 0) return;
    await tx.execute(sql`
      UPDATE warmer_daily_sends SET count = greatest(0, count - ${n})
       WHERE engine = ${sender.engine} AND device_id = ${sender.id} AND day = ${day}::date`);
  }

  // --- the Warmer page -----------------------------------------------------------------------------

  /** Every number of the workspace, with its profile, today's budget and its health. */
  async list(orgId: number): Promise<WarmerList> {
    const day = todayUtc(this.now());
    // Personal numbers are left out while the platform switch is off (owner decision 2026-10-05); their profiles are kept.
    const unofficialOn = await this.unofficial.isEnabledFor(orgId);
    const items = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const devices = await tx.execute(sql`
        SELECT id, uuid, device_name AS label, country_code, phone_number, status, warmer_config, created_at
          FROM devices WHERE org_id = ${orgId} AND ${unofficialOn}::boolean ORDER BY id`);
      const configs = await tx.execute(sql`
        SELECT id, uuid, provider, display_label AS label, phone_number, status, warmer_config, created_at
          FROM wa_provider_configs WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio') ORDER BY id`);
      const out: WarmerNumber[] = [];
      for (const r of devices.rows as Array<Record<string, unknown>>) {
        out.push(await this.row(tx, 'baileys', r, day));
      }
      for (const r of configs.rows as Array<Record<string, unknown>>) {
        out.push(await this.row(tx, String(r.provider), r, day));
      }
      return out;
    });
    return { items, defaults: { ...WARMER_DEFAULTS } };
  }

  /** Saves a number's profile. The ramp's start is stamped the first time it is enabled and kept, so re-saving never resets it. */
  async save(orgId: number, key: string, input: WarmerProfileInput): Promise<WarmerNumber> {
    const [engine, uuid] = key.split(':');
    if (!engine || !uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) throw AppError.notFound('Number', key);
    if (engine === UNOFFICIAL_ENGINE) await this.unofficial.assertEnabledFor(orgId);
    const table = engine === 'baileys' ? 'devices' : 'wa_provider_configs';
    const day = todayUtc(this.now());
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const found = await tx.execute(
        engine === 'baileys'
          ? sql`SELECT id, warmer_config FROM devices WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`
          : sql`SELECT id, warmer_config FROM wa_provider_configs
                 WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND provider = ${engine} FOR UPDATE`,
      );
      const row = found.rows[0] as { id: number | string; warmer_config: unknown } | undefined;
      if (!row) throw AppError.notFound('Number', key);
      const stored = startedAtOf(row.warmer_config);
      const startedAt = stored ?? (input.enabled ? day : null);
      const config = { ...input, ...(startedAt ? { startedAt } : {}) };
      await tx.execute(
        engine === 'baileys'
          ? sql`UPDATE devices SET warmer_config = ${JSON.stringify(config)}::jsonb WHERE org_id = ${orgId} AND id = ${Number(row.id)}`
          : sql`UPDATE wa_provider_configs SET warmer_config = ${JSON.stringify(config)}::jsonb WHERE org_id = ${orgId} AND id = ${Number(row.id)}`,
      );
      void table;
      const fresh =
        engine === 'baileys'
          ? await tx.execute(
              sql`SELECT id, uuid, device_name AS label, country_code, phone_number, status, warmer_config, created_at FROM devices WHERE org_id = ${orgId} AND id = ${Number(row.id)}`,
            )
          : await tx.execute(
              sql`SELECT id, uuid, provider, display_label AS label, phone_number, status, warmer_config, created_at FROM wa_provider_configs WHERE org_id = ${orgId} AND id = ${Number(row.id)}`,
            );
      return this.row(tx, engine, fresh.rows[0] as Record<string, unknown>, day);
    });
  }

  // --- internals -----------------------------------------------------------------------------------

  private async facts(tx: Tx, sender: Sender): Promise<NumberFacts | null> {
    const res = await tx.execute(
      sender.engine === 'baileys'
        ? sql`SELECT warmer_config, created_at, status FROM devices WHERE id = ${sender.id}`
        : sql`SELECT warmer_config, created_at, status FROM wa_provider_configs WHERE id = ${sender.id}`,
    );
    const r = res.rows[0] as
      { warmer_config: unknown; created_at: string | Date; status: string } | undefined;
    if (!r) return null;
    return {
      profile: profileOf(r.warmer_config),
      startedAt: startedAtOf(r.warmer_config),
      createdDay: new Date(r.created_at).toISOString().slice(0, 10),
      status: r.status,
    };
  }

  private async row(
    tx: Tx,
    engine: string,
    r: Record<string, unknown>,
    day: string,
  ): Promise<WarmerNumber> {
    const sender = { engine, id: Number(r.id) };
    const profile = profileOf(r.warmer_config);
    const startedAt = startedAtOf(r.warmer_config);
    const created = new Date(String(r.created_at)).toISOString().slice(0, 10);
    const budget = dailyBudgetFor(profile, startedAt, created, day);
    const sent = await this.sentOn(tx, sender, day);
    const phone = [r.country_code, r.phone_number].filter(Boolean).join('').replace(/\D+/g, '');
    const ageDays = Math.max(
      0,
      Math.floor((this.now().getTime() - new Date(String(r.created_at)).getTime()) / 86_400_000),
    );
    const failed24h = await this.failed24h(tx, sender);
    return {
      key: `${engine}:${String(r.uuid)}`,
      engine,
      label: String(r.label ?? '') || `${engine.toUpperCase()} #${sender.id}`,
      phone: phone ? `+${phone}` : null,
      status: String(r.status ?? ''),
      profile,
      startedAt,
      budget,
      sentToday: sent,
      remaining: Math.max(0, budget - sent),
      health: healthScore({
        status: String(r.status ?? ''),
        ageDays,
        sent24h: sent,
        failed24h,
        budget,
      }),
    };
  }

  /** Failed scheduled recipients of this number in the last day: the failure share of the health score. */
  private async failed24h(tx: Tx, sender: Sender): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n
        FROM scheduled_message_contacts c JOIN scheduled_messages m ON m.org_id = c.org_id AND m.id = c.scheduled_message_id
       WHERE m.provider = ${sender.engine} AND m.device_id = ${sender.id}
         AND c.status = 'failed' AND c.failed_at > now() - interval '24 hours'`);
    return Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0);
  }
}
