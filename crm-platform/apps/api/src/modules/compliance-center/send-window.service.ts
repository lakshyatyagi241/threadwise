import { Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ALLOW,
  decideSendWindow,
  type ContactSendWindow,
  type ContactTimezoneSource,
  policyOfSettings,
  resolveContactZones,
  windowActive,
  type SendWindowDecision,
  type SendWindowKind,
  type SendWindowPolicy,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { ComplianceRepository } from './compliance.repository';

/** Who a send goes to. A contact id is the exact answer; a phone or an email finds the contact the way the ConsentGate does. */
export interface SendWindowTarget {
  contactId?: number | null;
  /** A phone number as digits (a peer key) or E.164. Also read for its country code when the contact has no zone of their own. */
  phone?: string | null;
  email?: string | null;
}

export interface SendWindowOptions {
  /** Run inside the caller's transaction (it is already scoped to the workspace). */
  tx?: Tx;
  /** The instant the decision is for. Defaults to now. */
  now?: Date;
  /** A policy the caller already read (a loop reads it once per batch). */
  policy?: SendWindowPolicy;
}

export interface SendWindowMany {
  /** One decision per requested contact id. */
  decisions: Map<number, SendWindowDecision>;
  /** The ids that may go now. */
  allowed: Set<number>;
  /** The ids that wait, with the instant each may go. */
  held: Map<number, Extract<SendWindowDecision, { decision: 'hold' }>>;
  /** The earliest instant any held id may go, or null when nothing is held. */
  earliest: Date | null;
}

const CHUNK = 1000;
const LOG_EVERY_MS = 60_000;
/** When the windows could not be read, a marketing send waits this long and asks again: it never goes out unchecked. */
const UNREADABLE_RETRY_MS = 5 * 60_000;

type Raw = Record<string, unknown>;

interface ContactFacts {
  id: number;
  timezone: string | null;
  phone: string | null;
  /** The contact's normalized number as digits, to match a send that only knows a phone. */
  digits: string | null;
}

/**
 * Quiet hours and calling windows as a decision (BL-177). Every marketing send asks here "may this go now, or when?", right after the
 * ConsentGate allowed it. The rule is `decideSendWindow` (pure, unit tested); this class only collects the facts: the workspace
 * windows and, for the contact, their time zone and number.
 *
 * Only the MARKETING purpose is asked about. A service reply inside the 24 hour window and a utility notice are never held: the
 * callers pass the purpose through `holdsPurpose` and skip everything else before any query is made.
 *
 * Which clock (`resolveContactZones`): the contact's own time zone property, else the country code of their number, else the zone
 * chosen in Compliance center, else the workspace's zone, else UTC. With both windows off (the default) this costs one small
 * statement and answers `allow`.
 *
 * Failure: when the windows cannot be read the answer is a short hold (never an unchecked send), logged once a minute.
 */
@Injectable()
export class SendWindowService {
  private readonly logger = new Logger(SendWindowService.name);
  private lastLoggedAt = 0;

  /** Replaceable in tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ComplianceRepository,
  ) {}

  /** The workspace windows. */
  async policy(orgId: number, tx?: Tx): Promise<SendWindowPolicy> {
    const facts = await this.run(orgId, tx, (t) => this.repo.windowFacts(t, orgId));
    return policyOfSettings(facts, facts.workspaceTimezone);
  }

  /** One recipient. */
  async check(
    orgId: number,
    kind: SendWindowKind,
    target: SendWindowTarget,
    options: SendWindowOptions = {},
  ): Promise<SendWindowDecision> {
    const now = options.now ?? this.now();
    try {
      const policy = options.policy ?? (await this.policy(orgId, options.tx));
      if (!windowActive(policy, kind)) return ALLOW;
      const facts = await this.contactFacts(orgId, target, options.tx);
      return decideSendWindow(
        kind,
        policy,
        resolveContactZones(policy, {
          timezone: facts?.timezone ?? null,
          phone: facts?.phone ?? phoneOfTarget(target),
        }),
        now,
      );
    } catch (err) {
      return this.unreadable(orgId, err, now);
    }
  }

  /** An audience in one pass: the same windows for every contact id, the contacts' facts read by one statement per chunk. */
  async checkMany(
    orgId: number,
    kind: SendWindowKind,
    contactIds: readonly number[],
    options: SendWindowOptions = {},
  ): Promise<SendWindowMany> {
    const now = options.now ?? this.now();
    const unique = [...new Set(contactIds)];
    const decisions = new Map<number, SendWindowDecision>();
    try {
      const policy = options.policy ?? (await this.policy(orgId, options.tx));
      if (!windowActive(policy, kind) || unique.length === 0) {
        for (const id of unique) decisions.set(id, ALLOW);
      } else {
        const keys = await this.run(orgId, options.tx, (t) => this.timezoneKeys(t, orgId));
        // Contacts in the same zone get the same answer: it is computed once per distinct clock, not once per contact.
        const memo = new Map<string, SendWindowDecision>();
        for (let i = 0; i < unique.length; i += CHUNK) {
          const part = unique.slice(i, i + CHUNK);
          const where = sql`c.id IN (${sql.join(
            part.map((id) => sql`${id}::bigint`),
            sql`, `,
          )})`;
          const rows = await this.run(orgId, options.tx, (t) =>
            this.factRows(t, orgId, where, keys),
          );
          const byId = new Map(rows.map((r) => [r.id, r]));
          for (const id of part) {
            const f = byId.get(id);
            const resolved = resolveContactZones(policy, {
              timezone: f?.timezone ?? null,
              phone: f?.phone ?? null,
            });
            const key = `${resolved.source}|${resolved.zones.join(',')}|${resolved.fallback.zone}`;
            let d = memo.get(key);
            if (!d) {
              d = decideSendWindow(kind, policy, resolved, now);
              memo.set(key, d);
            }
            decisions.set(id, d);
          }
        }
      }
    } catch (err) {
      const d = this.unreadable(orgId, err, now);
      decisions.clear();
      for (const id of unique) decisions.set(id, d);
    }
    return summarise(decisions);
  }

  /**
   * An audience known only by phone numbers (a store's customers, a typed test recipient): the same windows, each number matched to its
   * contact when there is one, else read on the country code of the number itself. Keyed by the number as digits.
   */
  async checkPhones(
    orgId: number,
    kind: SendWindowKind,
    phones: readonly string[],
    options: SendWindowOptions = {},
  ): Promise<Map<string, SendWindowDecision>> {
    const now = options.now ?? this.now();
    const unique = [...new Set(phones.map((p) => p.replace(/\D+/g, '')).filter((d) => d !== ''))];
    const decisions = new Map<string, SendWindowDecision>();
    try {
      const policy = options.policy ?? (await this.policy(orgId, options.tx));
      if (!windowActive(policy, kind) || unique.length === 0) {
        for (const d of unique) decisions.set(d, ALLOW);
        return decisions;
      }
      const keys = await this.run(orgId, options.tx, (t) => this.timezoneKeys(t, orgId));
      const memo = new Map<string, SendWindowDecision>();
      for (let i = 0; i < unique.length; i += CHUNK) {
        const part = unique.slice(i, i + CHUNK);
        const where = sql`c.normalized_phone IN (${sql.join(
          part.flatMap((d) => [sql`${d}`, sql`${`+${d}`}`]),
          sql`, `,
        )})`;
        const rows = await this.run(orgId, options.tx, (t) => this.factRows(t, orgId, where, keys));
        const byDigits = new Map<string, ContactFacts>();
        for (const r of rows) if (r.digits && !byDigits.has(r.digits)) byDigits.set(r.digits, r);
        for (const d of part) {
          const f = byDigits.get(d);
          const resolved = resolveContactZones(policy, {
            timezone: f?.timezone ?? null,
            phone: f?.phone ?? phoneOfTarget({ phone: d }),
          });
          const key = `${resolved.source}|${resolved.zones.join(',')}|${resolved.fallback.zone}`;
          let dec = memo.get(key);
          if (!dec) {
            dec = decideSendWindow(kind, policy, resolved, now);
            memo.set(key, dec);
          }
          decisions.set(d, dec);
        }
      }
    } catch (err) {
      const d = this.unreadable(orgId, err, now);
      decisions.clear();
      for (const p of unique) decisions.set(p, d);
    }
    return decisions;
  }

  /**
   * The clock marketing messages to ONE contact are read on, what the quiet hours say about it right now, and what is already waiting
   * (BL-193). The same facts and the same rule as a send, so the screen can never disagree with the sender.
   */
  async contactWindow(
    orgId: number,
    contactId: number,
    options: SendWindowOptions = {},
  ): Promise<ContactSendWindow> {
    const now = options.now ?? this.now();
    const policy = options.policy ?? (await this.policy(orgId, options.tx));
    const facts = await this.contactFacts(orgId, { contactId }, options.tx);
    const stored = await this.run(orgId, options.tx, async (t) => {
      const res = await t.execute(sql`
        SELECT timezone, timezone_source FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`);
      const r = (res.rows as Raw[])[0];
      return {
        timezone: typeof r?.timezone === 'string' ? r.timezone : null,
        source: (typeof r?.timezone_source === 'string'
          ? r.timezone_source
          : null) as ContactTimezoneSource | null,
      };
    });
    const resolved = resolveContactZones(policy, {
      timezone: facts?.timezone ?? null,
      phone: facts?.phone ?? null,
    });
    const decision = decideSendWindow('message', policy, resolved, now);
    const single = resolved.zones.length === 1 ? (resolved.zones[0] ?? null) : null;
    const held = await this.run(orgId, options.tx, (t) => this.heldFor(t, orgId, contactId));
    return {
      timezone: stored.timezone,
      timezoneSource: stored.timezone === null ? null : (stored.source ?? 'staff'),
      clock: {
        zones: resolved.zones,
        zone: single,
        source: resolved.source,
        localTime: single ? localClock(now, single) : null,
      },
      quietHours: !windowActive(policy, 'message')
        ? 'off'
        : decision.decision === 'hold'
          ? 'held'
          : 'open',
      nextSendAt: decision.decision === 'hold' ? decision.until : null,
      heldCount: held.count,
      heldUntil: held.until?.toISOString() ?? null,
    };
  }

  /** What is already waiting for the quiet hours for one contact, across every sender that holds. */
  private async heldFor(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<{ count: number; until: Date | null }> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n, min(at) AS until FROM (
        SELECT held_until AS at FROM broadcast_contacts
          WHERE org_id = ${orgId} AND contact_id = ${contactId} AND status = 'pending' AND held_until IS NOT NULL
        UNION ALL
        SELECT held_until FROM wp_campaign_contacts
          WHERE org_id = ${orgId} AND contact_id = ${contactId} AND status = 'queued' AND held_until IS NOT NULL
        UNION ALL
        SELECT held_until FROM scheduled_message_contacts
          WHERE org_id = ${orgId} AND contact_id = ${contactId} AND status = 'pending' AND held_until IS NOT NULL
        UNION ALL
        SELECT r.held_until FROM line_broadcast_recipients r
          JOIN conversations c ON c.org_id = r.org_id AND c.id = r.conversation_id
          WHERE r.org_id = ${orgId} AND c.contact_id = ${contactId} AND r.status = 'pending' AND r.held_until IS NOT NULL
        UNION ALL
        SELECT r.held_until FROM facebook_broadcast_recipients r
          JOIN conversations c ON c.org_id = r.org_id AND c.id = r.conversation_id
          WHERE r.org_id = ${orgId} AND c.contact_id = ${contactId} AND r.status = 'pending' AND r.held_until IS NOT NULL
        UNION ALL
        SELECT r.held_until FROM telegram_broadcast_recipients r
          JOIN conversations c ON c.org_id = r.org_id AND c.id = r.conversation_id
          WHERE r.org_id = ${orgId} AND c.contact_id = ${contactId} AND r.status = 'pending' AND r.held_until IS NOT NULL
        UNION ALL
        SELECT r.held_until FROM viber_broadcast_recipients r
          JOIN conversations c ON c.org_id = r.org_id AND c.id = r.conversation_id
          WHERE r.org_id = ${orgId} AND c.contact_id = ${contactId} AND r.status = 'pending' AND r.held_until IS NOT NULL
        UNION ALL
        SELECT (m.meta -> 'hold' ->> 'until')::timestamptz FROM messages m
          JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
          WHERE m.org_id = ${orgId} AND c.contact_id = ${contactId} AND m.direction = 'out' AND m.status = 'queued'
            AND m.meta ? 'hold' AND m.created_at > now() - interval '7 days'
      ) x`);
    const r = (res.rows as Raw[])[0];
    return {
      count: Number(r?.n ?? 0),
      until: r?.until ? new Date(r.until as string) : null,
    };
  }

  // --- facts ------------------------------------------------------------------------------------------------------------------

  private async contactFacts(
    orgId: number,
    target: SendWindowTarget,
    tx?: Tx,
  ): Promise<ContactFacts | null> {
    const where = targetMatch(target);
    if (!where) return null;
    const keys = await this.run(orgId, tx, (t) => this.timezoneKeys(t, orgId));
    const rows = await this.run(orgId, tx, (t) => this.factRows(t, orgId, where, keys));
    return rows[0] ?? null;
  }

  /** The storage keys of the contact properties of type "timezone", then the conventional `timezone`. */
  private async timezoneKeys(tx: Tx, orgId: number): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT key FROM fields
      WHERE org_id = ${orgId} AND module_key = 'contacts' AND field_type = 'timezone' AND is_active
      ORDER BY position, id LIMIT 3`);
    const keys = (res.rows as Raw[]).map((r) => String(r.key));
    if (!keys.includes('timezone')) keys.push('timezone');
    return keys;
  }

  private async factRows(
    tx: Tx,
    orgId: number,
    where: SQL,
    keys: readonly string[],
  ): Promise<ContactFacts[]> {
    // The zone stored on the contact (BL-193) wins over the older time zone property.
    const tz = sql.join(
      [
        sql`NULLIF(btrim(c.timezone), '')`,
        ...keys.map((k) => sql`NULLIF(btrim(c.data ->> ${k}), '')`),
      ],
      sql`, `,
    );
    const res = await tx.execute(sql`
      SELECT c.id, COALESCE(${tz}) AS tz, c.phone, c.country_code, c.normalized_phone
      FROM contacts c
      WHERE c.org_id = ${orgId} AND ${where}
      ORDER BY c.id`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      timezone: typeof r.tz === 'string' ? r.tz : null,
      phone: phoneForZone(r),
      digits:
        typeof r.normalized_phone === 'string'
          ? r.normalized_phone.replace(/\D+/g, '') || null
          : null,
    }));
  }

  private run<T>(orgId: number, tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : this.db.txAs({ orgId, userId: null }, fn);
  }

  /** The windows could not be read: wait a few minutes and ask again, never send unchecked. */
  private unreadable(orgId: number, err: unknown, now: Date): SendWindowDecision {
    const t = Date.now();
    if (t - this.lastLoggedAt >= LOG_EVERY_MS) {
      this.lastLoggedAt = t;
      this.logger.error(
        { orgId, err: err instanceof Error ? err.message : String(err) },
        '[SENDWINDOW] the quiet hours could not be read; marketing waits and asks again',
      );
    }
    return {
      decision: 'hold',
      reason: 'quiet_hours',
      until: new Date(now.getTime() + UNREADABLE_RETRY_MS).toISOString(),
      zone: null,
      zoneSource: 'utc',
    };
  }
}

/**
 * Only the marketing purpose is held. A service reply and a utility notice go straight through: they are what the person asked for, and
 * a hold on an order confirmation or a support answer would hurt them and protect nobody.
 */
export function holdsPurpose(ledgerPurpose: 'marketing' | 'utility' | null | undefined): boolean {
  return ledgerPurpose === 'marketing';
}

/** `HH:mm` on the clock of `zone` at `at`. */
function localClock(at: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

function summarise(decisions: Map<number, SendWindowDecision>): SendWindowMany {
  const allowed = new Set<number>();
  const held: SendWindowMany['held'] = new Map();
  let earliest: Date | null = null;
  for (const [id, d] of decisions) {
    if (d.decision === 'allow') {
      allowed.add(id);
      continue;
    }
    held.set(id, d);
    const at = new Date(d.until);
    if (earliest === null || at.getTime() < earliest.getTime()) earliest = at;
  }
  return { decisions, allowed, held, earliest };
}

/** How a target finds its contact row, or null when it names nobody (the zone then comes from the number alone). */
function targetMatch(target: SendWindowTarget): SQL | null {
  if (target.contactId != null) return sql`c.id = ${target.contactId}`;
  const digits = (target.phone ?? '').replace(/[^0-9]/g, '');
  if (digits.length >= 6 && digits.length <= 15) {
    return sql`c.normalized_phone IN (${digits}, ${`+${digits}`})`;
  }
  const email = (target.email ?? '').trim().toLowerCase();
  return email.includes('@') ? sql`c.normalized_email = ${email}` : null;
}

/** A number as seen by a peer key carries its country code (WhatsApp ids always do). */
function phoneOfTarget(target: SendWindowTarget): string | null {
  const digits = (target.phone ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 7 ? digits : null;
}

/**
 * The number of a contact for reading its country code: the normalized E.164 one, else the stored phone when it is written with its
 * plus or the contact has a country code. A bare local number gives null, because guessing the country would put the wrong clock on
 * a person.
 */
function phoneForZone(r: Raw): string | null {
  const normalized = typeof r.normalized_phone === 'string' ? r.normalized_phone.trim() : '';
  if (normalized.startsWith('+')) return normalized;
  const phone = typeof r.phone === 'string' ? r.phone.trim() : '';
  const cc = (typeof r.country_code === 'string' ? r.country_code : '').replace(/\D+/g, '');
  const local = phone.replace(/\D+/g, '');
  if (local === '') return null;
  if (phone.startsWith('+')) return local;
  if (cc !== '') return local.startsWith(cc) ? local : `${cc}${local}`;
  return null;
}
