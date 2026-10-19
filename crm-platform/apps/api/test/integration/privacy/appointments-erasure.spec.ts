import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Tx } from '@crm/db';
import {
  PersonalDataErasureService,
  ALL_TIERS,
} from '../../../src/modules/privacy/engine/erasure.service';
import { SubjectResolver } from '../../../src/modules/privacy/engine/subject-resolver';
import { LegalHoldGuard } from '../../../src/modules/privacy/legal-holds/legal-hold.guard';

/** These tests hold nobody: the guard only reads through the transaction it is given, so it needs no database service of its own. */
const noHold = new LegalHoldGuard(null as never);

/**
 * A data request that erases a person must leave no trace of them in their bookings.
 *
 * `appointments.title` is built at booking time as "<booking type> — <invitee name>" (booking.service.ts) and the column is NOT NULL,
 * so it needs a placeholder, not NULL. It was missing from the manifest's `set`, so the invitee's name survived an erasure of a table
 * declared `anonymise`. This test books a person with their name in every free-text column, runs the real erasure pipeline on a real
 * migrated Postgres, and then reads each appointment back as text (every column at once, so a column added later is covered too).
 */
describe('privacy: erasing a person anonymises every personal column of their appointments', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let orgId: number;
  let rita: number;
  let other: number;
  let linked: number;
  let byEmailOnly: number;
  let unrelated: number;

  const NAME = 'Rita Sharma';
  const PHONE = '+919812300077';
  const EMAIL = 'rita.sharma@example.test';
  const TOKEN_HASH = 'a1b2c3-token-hash-of-rita';

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  /** The whole row as one text value: every column, in one string. */
  const rowText = async (id: number): Promise<string> =>
    String(
      (await owner.query(`SELECT a::text AS t FROM appointments a WHERE id = $1`, [id])).rows[0].t,
    );

  async function book(over: {
    contactId: number | null;
    typeId: number;
    startH: number;
    title: string;
    name: string;
    email: string;
    phone: string;
    token: string;
  }): Promise<number> {
    return one(
      `INSERT INTO appointments (
         org_id, booking_type_id, contact_id, title, description, location,
         starts_at, ends_at, status, source,
         invitee_name, invitee_email, invitee_phone, notes, answers, meta,
         meet_url, manage_token_hash, manage_token_cipher,
         calendar_event_id, calendar_id, calendar_provider,
         google_pushed_attendee, google_event_etag, cancel_reason, cancelled_by, cancelled_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         '2026-11-02T10:00:00Z'::timestamptz + ($7 || ' hours')::interval,
         '2026-11-02T10:30:00Z'::timestamptz + ($7 || ' hours')::interval, 'cancelled', 'link',
         $8, $9, $10, $11, $12::jsonb, $13::jsonb,
         $14, $15, $16,
         'evt_9f3k2', 'primary', 'google',
         $17, 'etag-1', $18, 'invitee', now()
       ) RETURNING id`,
      [
        orgId,
        over.typeId,
        over.contactId,
        over.title,
        `Call with ${over.name}`,
        `${over.name}, 12 Park Street`,
        String(over.startH),
        over.name,
        over.email,
        over.phone,
        `v1:${Buffer.from(`notes about ${over.name}`).toString('base64')}`,
        JSON.stringify({ q1: over.name, q2: over.phone }),
        JSON.stringify({ customer_name: over.name, customer_email: over.email }),
        `https://meet.example.test/${over.token}`,
        over.token,
        `v1:${over.token}`,
        over.email.toLowerCase(),
        `Sorry, ${over.name} cannot make it`,
      ],
    );
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });

    orgId = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('apt-erase','Erase Org','starter') RETURNING id`,
    );
    const typeId = await one(
      `INSERT INTO booking_types (org_id, name, slug, location_value) VALUES ($1,'Consultation','consultation','12 Park Street') RETURNING id`,
      [orgId],
    );
    rita = await one(
      `INSERT INTO contacts (org_id, name, phone, email) VALUES ($1,$2,$3,$4) RETURNING id`,
      [orgId, NAME, PHONE, EMAIL],
    );
    other = await one(
      `INSERT INTO contacts (org_id, name, phone, email) VALUES ($1,'Omar Khan','+919812300088','omar.khan@example.test') RETURNING id`,
      [orgId],
    );

    // The exact title format of BookingService.book: `${type.name} — ${invitee name}`.
    linked = await book({
      contactId: rita,
      typeId,
      startH: 0,
      title: `Consultation — ${NAME}`,
      name: NAME,
      email: EMAIL,
      phone: PHONE,
      token: TOKEN_HASH,
    });
    // A booking made on the public page that never got a contact link: found through the invitee's email address.
    byEmailOnly = await book({
      contactId: null,
      typeId,
      startH: 2,
      title: `Consultation — ${NAME}`,
      name: NAME,
      email: EMAIL.toUpperCase(),
      phone: '+919812300099',
      token: 'token-hash-by-email',
    });
    unrelated = await book({
      contactId: other,
      typeId,
      startH: 4,
      title: 'Consultation — Omar Khan',
      name: 'Omar Khan',
      email: 'omar.khan@example.test',
      phone: '+919812300088',
      token: 'token-hash-of-omar',
    });
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('the fixture really has the name in the title and elsewhere before the erasure', async () => {
    const before = await rowText(linked);
    expect(before).toContain(`Consultation — ${NAME}`);
    expect(before).toContain(NAME);
    expect(before).toContain(EMAIL);
  });

  it("a dry run counts both of the person's bookings and changes nothing", async () => {
    const subject = await resolveContact();
    const run = await eraseOnce(subject, true);
    const line = run.report.lines.find((l) => l.table === 'appointments');
    expect(line?.disposition).toBe('anonymised');
    expect(line?.count).toBe(2);
    expect(await rowText(linked)).toContain(NAME);
  });

  it("after the erasure no column of the person's bookings holds their name, number, address or token", async () => {
    const subject = await resolveContact();
    const run = await eraseOnce(subject, false);
    expect(run.report.lines.find((l) => l.table === 'appointments')?.count).toBe(2);

    for (const id of [linked, byEmailOnly]) {
      const after = (await rowText(id)).toLowerCase();
      for (const trace of [
        'rita',
        'sharma',
        '9812300077',
        '9812300099',
        'park street',
        'meet.example.test',
        'token-hash',
        'a1b2c3',
        'cannot make it',
      ]) {
        expect(after, `appointment ${id} still holds "${trace}": ${after}`).not.toContain(trace);
      }
      const row = (
        await owner.query(
          `SELECT title, invitee_name, invitee_email, invitee_phone, notes, description, location, answers, meta, meet_url,
                  manage_token_hash, manage_token_cipher, google_pushed_attendee, cancel_reason
             FROM appointments WHERE id = $1`,
          [id],
        )
      ).rows[0];
      // NOT NULL column: a visible placeholder, never the name and never a blank row in the list.
      expect(row.title).toBe('[erased]');
      for (const c of Object.keys(row).filter((k) => k !== 'title')) {
        expect(row[c], `${c} should be NULL after the erasure`).toBeNull();
      }
    }
  });

  it('the booking stays for reporting: time, status, type and price are untouched', async () => {
    const r = (
      await owner.query(
        `SELECT status, booking_type_id, starts_at, ends_at, source, price_minor FROM appointments WHERE id = $1`,
        [linked],
      )
    ).rows[0];
    expect(r.status).toBe('cancelled');
    expect(r.booking_type_id).not.toBeNull();
    expect(new Date(r.starts_at).toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(new Date(r.ends_at).toISOString()).toBe('2026-11-02T10:30:00.000Z');
    expect(r.source).toBe('link');
    expect(Number(r.price_minor)).toBe(0);
  });

  it("another person's booking in the same workspace is not touched", async () => {
    const after = await rowText(unrelated);
    expect(after).toContain('Consultation — Omar Khan');
    expect(after).toContain('omar.khan@example.test');
  });

  // --- helpers -----------------------------------------------------------------------------------------------------------------

  async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    await owner.query('BEGIN');
    try {
      const out = await fn(drizzle(owner) as unknown as Tx);
      await owner.query('COMMIT');
      return out;
    } catch (err) {
      await owner.query('ROLLBACK');
      throw err;
    }
  }

  function resolveContact() {
    return inTx((tx) =>
      new SubjectResolver().resolve(tx, orgId, { kind: 'contact', contactId: rita }),
    );
  }

  function eraseOnce(subject: Awaited<ReturnType<typeof resolveContact>>, dryRun: boolean) {
    return inTx((tx) =>
      new PersonalDataErasureService(new SubjectResolver(), noHold).run(tx, {
        orgId,
        requestId: null,
        subject,
        tiers: ALL_TIERS,
        mode: 'delete',
        dryRun,
      }),
    );
  }
});
