import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The appointments tables against a real Postgres, as the restricted application role (a superuser bypasses every policy and would
 * make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners skip RLS but never
 * CHECK, UNIQUE, EXCLUDE or FK.
 *
 * The centrepiece is the exclusion constraint (EXT-APPT-05, D-05): the database itself refuses two active bookings of one booking
 * type on one seat over overlapping time, so a double booking cannot happen even if a code path forgets the application's lock.
 */
describe('appointments: schema, constraints, isolation and the double-booking guarantee', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userB: number;
  let typeA: number;
  let typeA2: number;
  let typeB: number;

  const url = () => container.getConnectionUri();
  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  /** An appointment row straight into the table; `startH` and `endH` are hours after 2026-10-05T00:00Z. */
  const appt = (
    org: number,
    type: number | null,
    startH: number,
    endH: number,
    over: { seat?: number; status?: string; token?: string | null; client?: Client } = {},
  ) =>
    (over.client ?? owner).query(
      `INSERT INTO appointments (org_id, booking_type_id, title, starts_at, ends_at, status, seat, manage_token_hash)
       VALUES ($1,$2,'T', '2026-10-05T00:00:00Z'::timestamptz + ($3 || ' hours')::interval,
               '2026-10-05T00:00:00Z'::timestamptz + ($4 || ' hours')::interval, $5, $6, $7) RETURNING id`,
      [
        org,
        type,
        String(startH),
        String(endH),
        over.status ?? 'confirmed',
        over.seat ?? 1,
        over.token === undefined ? null : over.token,
      ],
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: url() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(url(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });

    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('apa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('apb','B','starter') RETURNING id`,
    );
    await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@ap.test','A','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@ap.test','B','x') RETURNING id`,
      [orgB],
    );
    const type = (org: number, slug: string) =>
      one(`INSERT INTO booking_types (org_id, name, slug) VALUES ($1,$2,$2) RETURNING id`, [
        org,
        slug,
      ]);
    typeA = await type(orgA, 'demo');
    typeA2 = await type(orgA, 'other');
    typeB = await type(orgB, 'demo');

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const rejects = (p: Promise<unknown>, pattern: RegExp) => expect(p).rejects.toThrow(pattern);

  describe('row-level security', () => {
    const TABLES = [
      'booking_types',
      'booking_availability_rules',
      'booking_availability_overrides',
      'booking_questions',
      'booking_reminders',
      'booking_templates',
      'booking_financials',
      'booking_integrations',
      'slot_reservations',
      'appointments',
      'appointment_reminder_runs',
    ];

    it('every appointments table has RLS enabled and forced with a tenant policy', async () => {
      const res = await owner.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class c WHERE c.relname = ANY($1) AND c.relkind = 'r'`,
        [TABLES],
      );
      expect(res.rows).toHaveLength(TABLES.length);
      for (const r of res.rows) {
        expect(r, r.relname).toMatchObject({
          relrowsecurity: true,
          relforcerowsecurity: true,
          policies: 1,
        });
      }
    });

    it('a workspace sees only its own booking types and appointments, even when the other id is known exactly', async () => {
      const a = Number((await appt(orgA, typeA, 0, 1)).rows[0].id);
      const b = Number((await appt(orgB, typeB, 0, 1)).rows[0].id);
      const own = await asOrg(
        orgA,
        async () => (await app.query(`SELECT id FROM appointments`)).rows,
      );
      expect(own.map((r) => Number(r.id))).toEqual([a]);
      const types = await asOrg(
        orgA,
        async () => (await app.query(`SELECT id FROM booking_types`)).rows,
      );
      expect(types.map((r) => Number(r.id)).sort()).toEqual([typeA, typeA2].sort());
      const other = await asOrg(
        orgA,
        async () =>
          (await app.query(`SELECT 1 FROM appointments WHERE org_id = $1 AND id = $2`, [orgB, b]))
            .rows,
      );
      expect(other).toHaveLength(0);
      await owner.query(`DELETE FROM appointments WHERE org_id IN ($1, $2)`, [orgA, orgB]);
    });

    it('with no tenant set a query sees nothing, and a write into another workspace is refused by WITH CHECK', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT 1 FROM booking_types`)).rows).toHaveLength(0);
        expect((await app.query(`SELECT 1 FROM appointment_reminder_runs`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
        await expect(
          app.query(
            `INSERT INTO appointments (org_id, title, starts_at, ends_at) VALUES ($1,'smuggled', now(), now() + interval '1 hour')`,
            [orgB],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });

  describe('foreign keys are composite', () => {
    it("an appointment cannot point at another workspace's booking type, host or creator", async () => {
      await rejects(appt(orgA, typeB, 0, 1), /fk_appointments_booking_type_id/);
      await rejects(
        owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at, user_id) VALUES ($1,'x',now(),now() + interval '1 hour',$2)`,
          [orgA, userB],
        ),
        /fk_appointments_user_id/,
      );
      await rejects(
        owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at, created_by) VALUES ($1,'x',now(),now() + interval '1 hour',$2)`,
          [orgA, userB],
        ),
        /fk_appointments_created_by/,
      );
    });

    it('deleting a booking type removes its children and keeps the appointments, which only lose the link (D-10)', async () => {
      const t = await one(
        `INSERT INTO booking_types (org_id, name, slug) VALUES ($1,'gone','gone') RETURNING id`,
        [orgA],
      );
      await owner.query(
        `INSERT INTO booking_availability_rules (org_id, booking_type_id, weekday, start_time, end_time) VALUES ($1,$2,1,'09:00','10:00')`,
        [orgA, t],
      );
      await owner.query(
        `INSERT INTO booking_reminders (org_id, booking_type_id, offset_index, offset_minutes) VALUES ($1,$2,0,60)`,
        [orgA, t],
      );
      const a = Number((await appt(orgA, t, 10, 11)).rows[0].id);
      await owner.query(`DELETE FROM booking_types WHERE org_id = $1 AND id = $2`, [orgA, t]);
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM booking_availability_rules WHERE booking_type_id = $1`,
            [t],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM booking_reminders WHERE booking_type_id = $1`,
            [t],
          )
        ).rows[0].n,
      ).toBe(0);
      const kept = await owner.query(`SELECT booking_type_id FROM appointments WHERE id = $1`, [a]);
      expect(kept.rows[0].booking_type_id).toBeNull();
      await owner.query(`DELETE FROM appointments WHERE id = $1`, [a]);
    });
  });

  describe('the double-booking guarantee (EXT-APPT-05)', () => {
    const clear = () =>
      owner.query(`DELETE FROM appointments WHERE org_id IN ($1, $2)`, [orgA, orgB]);

    it('refuses an overlapping booking of the same type and seat, whatever its start', async () => {
      await clear();
      await appt(orgA, typeA, 9, 10);
      await rejects(appt(orgA, typeA, 9, 10), /excl_appointments_seat_time/);
      // Reference's unique key only caught an IDENTICAL start; these overlap with different starts.
      await rejects(appt(orgA, typeA, 9.5, 10.5), /excl_appointments_seat_time/);
      await rejects(appt(orgA, typeA, 8.5, 9.5), /excl_appointments_seat_time/);
      await rejects(appt(orgA, typeA, 8, 11), /excl_appointments_seat_time/);
      await rejects(appt(orgA, typeA, 9.25, 9.75), /excl_appointments_seat_time/);
    });

    it('half-open ranges: back-to-back bookings do not collide', async () => {
      await clear();
      await appt(orgA, typeA, 9, 10);
      await appt(orgA, typeA, 10, 11);
      await appt(orgA, typeA, 8, 9);
      expect(
        (await owner.query(`SELECT count(*)::int AS n FROM appointments WHERE org_id = $1`, [orgA]))
          .rows[0].n,
      ).toBe(3);
    });

    it('another seat, another type and another workspace are separate columns of time', async () => {
      await clear();
      await appt(orgA, typeA, 9, 10, { seat: 1 });
      await appt(orgA, typeA, 9, 10, { seat: 2 });
      await appt(orgA, typeA2, 9, 10);
      await appt(orgB, typeB, 9, 10);
      await rejects(appt(orgA, typeA, 9, 10, { seat: 2 }), /excl_appointments_seat_time/);
    });

    it('pending and confirmed hold the slot; cancelled, declined, completed and no-show release it', async () => {
      await clear();
      await appt(orgA, typeA, 9, 10, { status: 'pending' });
      await rejects(
        appt(orgA, typeA, 9, 10, { status: 'confirmed' }),
        /excl_appointments_seat_time/,
      );
      for (const s of ['cancelled', 'declined', 'completed', 'no_show']) {
        await appt(orgA, typeA, 9, 10, { status: s });
      }
      // And the slot frees in the very statement that changes the status.
      const id = Number(
        (
          await owner.query(
            `SELECT id FROM appointments WHERE org_id = $1 AND status = 'pending'`,
            [orgA],
          )
        ).rows[0].id,
      );
      await owner.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [id]);
      await appt(orgA, typeA, 9, 10, { status: 'confirmed' });
    });

    it('moving a booking onto another one is refused, moving it onto free time is not (reschedule), and re-activating a cancelled one re-checks', async () => {
      await clear();
      const a = Number((await appt(orgA, typeA, 9, 10)).rows[0].id);
      await appt(orgA, typeA, 11, 12);
      await rejects(
        owner.query(
          `UPDATE appointments SET starts_at = starts_at + interval '2 hours', ends_at = ends_at + interval '2 hours' WHERE id = $1`,
          [a],
        ),
        /excl_appointments_seat_time/,
      );
      await owner.query(
        `UPDATE appointments SET starts_at = starts_at + interval '5 hours', ends_at = ends_at + interval '5 hours' WHERE id = $1`,
        [a],
      );
      await owner.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [a]);
      await appt(orgA, typeA, 14, 15);
      await rejects(
        owner.query(`UPDATE appointments SET status = 'confirmed' WHERE id = $1`, [a]),
        /excl_appointments_seat_time/,
      );
    });

    it('an appointment with no booking type (a manual entry, or one whose type was deleted) is not constrained', async () => {
      await clear();
      await appt(orgA, null, 9, 10);
      await appt(orgA, null, 9, 10);
    });

    it('concurrent inserts for one slot from separate connections: exactly one wins, with no lock at all', async () => {
      await clear();
      const N = 12;
      const clients = await Promise.all(
        Array.from({ length: N }, async () => {
          const c = new Client({ connectionString: url() });
          await c.connect();
          return c;
        }),
      );
      try {
        const results = await Promise.allSettled(
          clients.map((c) => appt(orgA, typeA, 9, 10, { client: c })),
        );
        const won = results.filter((r) => r.status === 'fulfilled');
        const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(N - 1);
        // Racing inserters either lose on the constraint or are chosen as the victim of the deadlock the constraint's check can raise.
        for (const l of lost)
          expect(String(l.reason)).toMatch(/excl_appointments_seat_time|deadlock detected/);
        expect(
          (
            await owner.query(`SELECT count(*)::int AS n FROM appointments WHERE org_id = $1`, [
              orgA,
            ])
          ).rows[0].n,
        ).toBe(1);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    });

    it('concurrent inserts for a group type: as many winners as seats when each picks a seat, never two on one seat', async () => {
      await clear();
      const SEATS = 3;
      const N = 9;
      const clients = await Promise.all(
        Array.from({ length: N }, async () => {
          const c = new Client({ connectionString: url() });
          await c.connect();
          return c;
        }),
      );
      try {
        // Every client tries seats 1..3 in order, as the service does when a seat is taken.
        const results = await Promise.all(
          clients.map(async (c) => {
            for (let seat = 1; seat <= SEATS; seat++) {
              try {
                await appt(orgA, typeA, 9, 10, { seat, client: c });
                return seat;
              } catch (e) {
                if (!/excl_appointments_seat_time|deadlock detected/.test(String(e))) throw e;
              }
            }
            return null;
          }),
        );
        const seats = results.filter((s) => s !== null);
        // Never two on one seat, and never more winners than seats (a deadlock victim may leave a seat unfilled in a single round).
        expect(new Set(seats).size).toBe(seats.length);
        expect(seats.length).toBeLessThanOrEqual(SEATS);
        expect(seats.length).toBeGreaterThanOrEqual(1);
        const rows = await owner.query(
          `SELECT seat FROM appointments WHERE org_id = $1 ORDER BY seat`,
          [orgA],
        );
        expect(rows.rows.map((r) => r.seat)).toEqual([...seats].sort());
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    });
  });

  describe('value rules', () => {
    it('booking types: ranges, location types, colours', async () => {
      const bad = (cols: string, vals: unknown[]) =>
        owner.query(
          `INSERT INTO booking_types (org_id, name, slug, ${cols}) VALUES ($1,'x',$2, ${vals.map((_, i) => `$${i + 3}`).join(',')})`,
          [orgA, `v${Math.random()}`, ...vals],
        );
      await rejects(bad('duration_minutes', [4]), /chk_booking_types_duration/);
      await rejects(bad('duration_minutes', [1441]), /chk_booking_types_duration/);
      await rejects(bad('max_advance_days', [0]), /chk_booking_types_advance/);
      await rejects(bad('capacity', [0]), /chk_booking_types_capacity/);
      await rejects(bad('max_per_day', [0]), /chk_booking_types_per_day/);
      await rejects(bad('location_type', ['moon']), /chk_booking_types_location_type/);
      await rejects(bad('color', ['green']), /chk_booking_types_color/);
      await rejects(
        owner.query(`INSERT INTO booking_types (org_id, name, slug) VALUES ($1,'   ','blank')`, [
          orgA,
        ]),
        /chk_booking_types_name/,
      );
      await rejects(
        owner.query(`INSERT INTO booking_types (org_id, name, slug) VALUES ($1,'dup','demo')`, [
          orgA,
        ]),
        /uq_booking_types_slug/,
      );
      await owner.query(
        `INSERT INTO booking_types (org_id, name, slug, location_type) VALUES ($1,'wa','wa-ok','whatsapp')`,
        [orgA],
      );
    });

    it('appointments: status, range, seat, money, cancelled-by, currency', async () => {
      await rejects(
        owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at, status) VALUES ($1,'x',now(),now() + interval '1 hour','maybe')`,
          [orgA],
        ),
        /chk_appointments_status/,
      );
      await rejects(
        owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at) VALUES ($1,'x',now(),now())`,
          [orgA],
        ),
        /chk_appointments_range/,
      );
      await rejects(
        owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at, seat) VALUES ($1,'x',now(),now() + interval '1 hour',0)`,
          [orgA],
        ),
        /chk_appointments_seat/,
      );
      await rejects(
        owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at, price_minor) VALUES ($1,'x',now(),now() + interval '1 hour',-1)`,
          [orgA],
        ),
        /chk_appointments_money/,
      );
      await rejects(
        owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at, cancelled_by) VALUES ($1,'x',now(),now() + interval '1 hour','alien')`,
          [orgA],
        ),
        /chk_appointments_cancelled_by/,
      );
      await rejects(
        owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at, currency) VALUES ($1,'x',now(),now() + interval '1 hour','usd')`,
          [orgA],
        ),
        /chk_appointments_currency/,
      );
      await rejects(
        owner.query(`INSERT INTO appointments (org_id, title, starts_at) VALUES ($1,'x',now())`, [
          orgA,
        ]),
        /ends_at/,
      );
    });

    it('the manage token hash is unique across the whole system', async () => {
      await owner.query(`DELETE FROM appointments WHERE org_id IN ($1, $2)`, [orgA, orgB]);
      await appt(orgA, null, 1, 2, { token: 'h'.repeat(64) });
      await rejects(
        appt(orgB, null, 1, 2, { token: 'h'.repeat(64) }),
        /uq_appointments_manage_token_hash/,
      );
      // Rows without a token (a legacy row) do not collide with each other.
      await appt(orgA, null, 3, 4);
      await appt(orgA, null, 3, 4);
    });

    it('weekly intervals and date overrides', async () => {
      const rule = (wd: number, a: string, b: string) =>
        owner.query(
          `INSERT INTO booking_availability_rules (org_id, booking_type_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,$5)`,
          [orgA, typeA, wd, a, b],
        );
      await rejects(rule(7, '09:00', '10:00'), /chk_booking_availability_rules_weekday/);
      await rejects(rule(1, '10:00', '09:00'), /chk_booking_availability_rules_hours/);
      await rule(1, '09:00', '10:00');
      const ov = (date: string, closed: boolean, a: string | null, b: string | null) =>
        owner.query(
          `INSERT INTO booking_availability_overrides (org_id, booking_type_id, date, is_closed, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6)`,
          [orgA, typeA, date, closed, a, b],
        );
      await ov('2026-12-25', true, null, null);
      await rejects(
        ov('2026-12-26', true, '09:00', '10:00'),
        /chk_booking_availability_overrides_hours/,
      );
      await rejects(
        ov('2026-12-27', false, '09:00', null),
        /chk_booking_availability_overrides_hours/,
      );
      await rejects(
        ov('2026-12-27', false, '10:00', '09:00'),
        /chk_booking_availability_overrides_hours/,
      );
      await rejects(
        ov('2026-12-25', true, null, null),
        /uq_booking_availability_overrides_booking_type_id_date/,
      );
      await ov('2026-12-24', false, '09:00', '12:00');
    });

    it('reminders: positive offsets up to 30 days, distinct per type, and the positions can be swapped in one transaction', async () => {
      const rem = (i: number, m: number) =>
        owner.query(
          `INSERT INTO booking_reminders (org_id, booking_type_id, offset_index, offset_minutes) VALUES ($1,$2,$3,$4)`,
          [orgA, typeA2, i, m],
        );
      await rejects(rem(0, 0), /chk_booking_reminders_offset/);
      await rejects(rem(0, 43_201), /chk_booking_reminders_offset/);
      await rejects(rem(8, 60), /chk_booking_reminders_offset/);
      await rem(0, 1440);
      await rem(1, 180);
      await rejects(rem(2, 180), /uq_booking_reminders_booking_type_id_kind_offset/);
      await owner.query('BEGIN');
      await owner.query(
        `UPDATE booking_reminders SET offset_index = 1 WHERE org_id = $1 AND booking_type_id = $2 AND offset_index = 0`,
        [orgA, typeA2],
      );
      await owner.query(
        `UPDATE booking_reminders SET offset_index = 0 WHERE org_id = $1 AND booking_type_id = $2 AND offset_minutes = 180`,
        [orgA, typeA2],
      );
      await owner.query('COMMIT');
    });

    it('messages (email is a channel), price rows, reservations', async () => {
      const tpl = (ev: string, ch: string) =>
        owner.query(
          `INSERT INTO booking_templates (org_id, booking_type_id, event, channel) VALUES ($1,$2,$3,$4)`,
          [orgA, typeA, ev, ch],
        );
      await tpl('confirmation', 'email');
      await rejects(
        tpl('confirmation', 'email'),
        /uq_booking_templates_booking_type_id_event_channel/,
      );
      await rejects(tpl('confirmation', 'sms'), /chk_booking_templates_channel/);
      await rejects(
        owner.query(
          `INSERT INTO booking_financials (org_id, booking_type_id, fee_minor) VALUES ($1,$2,-1)`,
          [orgA, typeA],
        ),
        /chk_booking_financials_amounts/,
      );
      await rejects(
        owner.query(
          `INSERT INTO booking_financials (org_id, booking_type_id, currency) VALUES ($1,$2,'rupee')`,
          [orgA, typeA],
        ),
        /chk_booking_financials_currency/,
      );
      await rejects(
        owner.query(
          `INSERT INTO booking_financials (org_id, booking_type_id, tax_pct) VALUES ($1,$2,100.01)`,
          [orgA, typeA],
        ),
        /numeric field overflow|chk_booking_financials_tax/,
      );
      await owner.query(
        `INSERT INTO booking_financials (org_id, booking_type_id, fee_minor, currency) VALUES ($1,$2,10000,'USD')`,
        [orgA, typeA],
      );
      await rejects(
        owner.query(
          `INSERT INTO slot_reservations (org_id, booking_type_id, starts_at, ends_at, session_ref, channel, expires_at) VALUES ($1,$2,now(),now(),'s','c',now())`,
          [orgA, typeA],
        ),
        /chk_slot_reservations_range/,
      );
    });
  });

  describe('the reminder claims (TW-APPT-030, D-14, BL-283)', () => {
    const insert = `INSERT INTO appointment_reminder_runs (org_id, appointment_id, kind, offset_minutes, due_at, armed_at)`;
    const key = `ON CONFLICT (org_id, appointment_id, kind, offset_minutes, armed_at) DO NOTHING RETURNING id`;

    it("one claim per appointment, rule and arming: a second insert of the same run is ignored, which is the sweep's idempotency", async () => {
      await owner.query(`DELETE FROM appointments WHERE org_id IN ($1, $2)`, [orgA, orgB]);
      const a = Number((await appt(orgA, typeA, 20, 21)).rows[0].id);
      const armed = '2026-11-01T08:00:00Z';
      const claim = (kind = 'before', offset = 60, at = armed) =>
        owner.query(`${insert} VALUES ($1,$2,$3,$4, now(), $5) ${key}`, [orgA, a, kind, offset, at]);
      expect((await claim()).rows).toHaveLength(1);
      expect((await claim()).rows).toHaveLength(0);
      // 60 minutes after the end is a different rule from 60 minutes before the start.
      expect((await claim('after', 60)).rows).toHaveLength(1);
      // A reschedule moves the booking's arming: the same rule is claimed again for the new time.
      expect((await claim('before', 60, '2026-11-02T08:00:00Z')).rows).toHaveLength(1);
      await owner.query(`${insert} VALUES ($1,$2,'before',1440, now(), $3)`, [orgA, a, armed]);
      await rejects(
        owner.query(`${insert} VALUES ($1,$2,'before',1440, now(), $3)`, [orgA, a, armed]),
        /uq_appointment_reminder_runs/,
      );
      // A claim cannot name another workspace's appointment, and goes away with the appointment.
      await rejects(
        owner.query(`${insert} VALUES ($1,$2,'before',5, now(), $3)`, [orgB, a, armed]),
        /fk_appointment_reminder_runs_appointment/,
      );
      await owner.query(`DELETE FROM appointments WHERE id = $1`, [a]);
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM appointment_reminder_runs WHERE appointment_id = $1`,
            [a],
          )
        ).rows[0].n,
      ).toBe(0);
    });

    it('a run starts pending and only knows the outcomes the sweep writes; the kind is before or after', async () => {
      const a = Number((await appt(orgA, typeA, 22, 23)).rows[0].id);
      const run = await owner.query(
        `${insert} VALUES ($1,$2,'before',30, now(), now()) RETURNING status, attempts, reason, channel`,
        [orgA, a],
      );
      expect(run.rows[0]).toMatchObject({ status: 'pending', attempts: 0, reason: null, channel: null });
      await rejects(
        owner.query(`UPDATE appointment_reminder_runs SET status = 'delivered' WHERE appointment_id = $1`, [a]),
        /chk_appointment_reminder_runs_status/,
      );
      await rejects(
        owner.query(`UPDATE appointment_reminder_runs SET channel = 'fax' WHERE appointment_id = $1`, [a]),
        /chk_appointment_reminder_runs_channel/,
      );
      await rejects(
        owner.query(`${insert} VALUES ($1,$2,'during',31, now(), now())`, [orgA, a]),
        /chk_appointment_reminder_runs_kind/,
      );
    });
  });

  describe('the reminder rules (BL-283)', () => {
    it('a rule is created OFF, before the start, over every channel, and may exist before and after with the same offset', async () => {
      const t = await one(
        `INSERT INTO booking_types (org_id, name, slug) VALUES ($1,'rules','rules-t') RETURNING id`,
        [orgA],
      );
      const r = await owner.query(
        `INSERT INTO booking_reminders (org_id, booking_type_id, offset_index, offset_minutes) VALUES ($1,$2,0,60)
         RETURNING is_active, kind, channels, body, wa_template_id`,
        [orgA, t],
      );
      expect(r.rows[0]).toMatchObject({
        is_active: false,
        kind: 'before',
        channels: ['whatsapp', 'sms', 'email'],
        body: null,
        wa_template_id: null,
      });
      await owner.query(
        `INSERT INTO booking_reminders (org_id, booking_type_id, offset_index, offset_minutes, kind) VALUES ($1,$2,1,60,'after')`,
        [orgA, t],
      );
      await rejects(
        owner.query(
          `INSERT INTO booking_reminders (org_id, booking_type_id, offset_index, offset_minutes, kind) VALUES ($1,$2,2,60,'after')`,
          [orgA, t],
        ),
        /uq_booking_reminders_booking_type_id_kind_offset/,
      );
    });

    it('refuses an unknown kind, an empty or unknown channel list, an over-long text, and a template of another workspace', async () => {
      const t = await one(
        `INSERT INTO booking_types (org_id, name, slug) VALUES ($1,'rules2','rules-t2') RETURNING id`,
        [orgA],
      );
      const ins = (extra: string, vals: unknown[]) =>
        owner.query(
          `INSERT INTO booking_reminders (org_id, booking_type_id, offset_index, offset_minutes, ${extra.split('=')[0]})
           VALUES ($1,$2,5,5,${extra.split('=')[1]})`,
          [orgA, t, ...vals],
        );
      await rejects(ins('kind=$3', ['during']), /chk_booking_reminders_kind/);
      await rejects(ins("channels='{}'", []), /chk_booking_reminders_channels/);
      await rejects(ins("channels='{whatsapp,fax}'", []), /chk_booking_reminders_channels/);
      await rejects(ins('body=$3', ['x'.repeat(2001)]), /chk_booking_reminders_text/);
      await rejects(ins('wa_template_id=$3', [999_999_999]), /fk_booking_reminders_wa_template_id/);
    });
  });

  describe('optimistic locking', () => {
    it('every write bumps row_version (the touch trigger), so a stale editor can be told', async () => {
      const t = await one(
        `INSERT INTO booking_types (org_id, name, slug) VALUES ($1,'v','v-lock') RETURNING id`,
        [orgA],
      );
      const v1 = (await owner.query(`SELECT row_version FROM booking_types WHERE id = $1`, [t]))
        .rows[0].row_version;
      await owner.query(`UPDATE booking_types SET name = 'v2' WHERE id = $1`, [t]);
      const v2 = (await owner.query(`SELECT row_version FROM booking_types WHERE id = $1`, [t]))
        .rows[0].row_version;
      expect(v2).toBe(v1 + 1);
      const stale = await owner.query(
        `UPDATE booking_types SET name = 'v3' WHERE id = $1 AND row_version = $2 RETURNING id`,
        [t, v1],
      );
      expect(stale.rows).toHaveLength(0);
    });
  });
});
