import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shownSubscriptionLabel } from '../../../src/modules/contact-consent/consent-intake.rules';
import { whatsappSubscribedSql } from '../../../src/modules/crm/contacts/contact-conditions';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository';
import { startRlsPg, type RlsPg } from '../../support/rls-pg';

/**
 * The WhatsApp label the list shows, the segment filter counts, and the consent ledger must agree (row 355). The label columns and the
 * ledger are read in SQL under row-level security, so this runs on a real Postgres with every migration applied and the restricted app role.
 *
 * Rerun: pnpm --filter @crm/api exec vitest run test/integration/contact-consent/whatsapp-label-ledger.spec.ts --testTimeout=240000
 */
describe('WhatsApp label follows the consent ledger on a real database', () => {
  let rls: RlsPg;
  const repo = new ContactsRepository();
  let orgOn: number; // workspace with "Require recorded consent" on
  let orgOff: number; // workspace with the default (off)
  let legacyOn: number; // label subscribed, no ledger grant, switch on
  let grantedOn: number; // ledger grant, empty label, switch on
  let legacyOff: number; // label subscribed, no ledger grant, switch off
  let grantedOff: number; // ledger grant, empty label, switch off
  let otherOrgGranted: number; // ledger grant in the other workspace

  const scalar = async (q: string, params: unknown[] = []) =>
    Number((await rls.pg.owner.query(q, params)).rows[0].id);

  const contact = (org: number, name: string, label: string | null) =>
    scalar(
      `INSERT INTO contacts (org_id, name, whatsapp_subscription_status) VALUES ($1,$2,$3) RETURNING id`,
      [org, name, label],
    );

  const grant = async (org: number, contactId: number, key: string) => {
    const event = await scalar(
      `INSERT INTO contact_consent_events (org_id, contact_id, channel, purpose, action, source, idempotency_key)
       VALUES ($1,$2,'whatsapp','marketing','granted','manual',$3) RETURNING id`,
      [org, contactId, key],
    );
    await rls.pg.owner.query(
      `INSERT INTO contact_consent_state (org_id, contact_id, channel, purpose, state, last_event_id, last_occurred_at)
       VALUES ($1,$2,'whatsapp','marketing','granted',$3,now())`,
      [org, contactId, event],
    );
  };

  beforeAll(async () => {
    rls = await startRlsPg();
    orgOn = await rls.newOrg('label-on');
    orgOff = await rls.newOrg('label-off');
    await rls.pg.owner.query(
      `INSERT INTO contact_consent_settings (org_id, require_consent_for_marketing) VALUES ($1, true)`,
      [orgOn],
    );
    legacyOn = await contact(orgOn, 'legacy on', 'subscribed');
    grantedOn = await contact(orgOn, 'granted on', null);
    await grant(orgOn, grantedOn, 'grant-on');
    legacyOff = await contact(orgOff, 'legacy off', 'subscribed');
    grantedOff = await contact(orgOff, 'granted off', null);
    await grant(orgOff, grantedOff, 'grant-off');
    const other = await rls.newOrg('label-other');
    otherOrgGranted = await contact(other, 'other org granted', null);
    await grant(other, otherOrgGranted, 'grant-other');
  }, 240_000);

  afterAll(async () => {
    await rls?.stop();
  });

  /** The contact as the list reads it: the repository row, run as the app role in its workspace. */
  const shownLabel = (org: number, id: number) =>
    rls.inOrg(org, async (tx) => {
      const row = await repo.findById(tx as never, org, id);
      return row
        ? shownSubscriptionLabel(
            row.whatsappSubscriptionStatus,
            row.whatsappMarketingGranted,
            row.whatsappRequiresConsent,
          )
        : undefined;
    });

  it('switch on: a legacy label with no grant shows no label, a grant shows subscribed', async () => {
    expect(await shownLabel(orgOn, legacyOn)).toBeNull();
    expect(await shownLabel(orgOn, grantedOn)).toBe('subscribed');
  });

  it('switch off: a legacy label stays, a grant shows subscribed', async () => {
    expect(await shownLabel(orgOff, legacyOff)).toBe('subscribed');
    expect(await shownLabel(orgOff, grantedOff)).toBe('subscribed');
  });

  it('a contact of another workspace is not visible, and its grant does not count here', async () => {
    expect(await shownLabel(orgOn, otherOrgGranted)).toBeUndefined();
    const flags = await rls.inOrg(orgOn, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT id, ${whatsappSubscribedSql} AS subscribed FROM contacts WHERE org_id = ${orgOn}`,
      );
      return rows.rows as Array<{ id: number; subscribed: boolean }>;
    });
    expect(flags.find((r) => Number(r.id) === legacyOn)?.subscribed).toBe(false);
    expect(flags.find((r) => Number(r.id) === grantedOn)?.subscribed).toBe(true);
  });

  it('the segment filter counts what the list shows, per workspace setting', async () => {
    const countSubscribed = (org: number) =>
      rls.inOrg(org, async (tx) => {
        const r = await tx.execute(
          sql`SELECT count(*) FILTER (WHERE ${whatsappSubscribedSql})::int AS n FROM contacts WHERE org_id = ${org}`,
        );
        return Number((r.rows[0] as { n: number }).n);
      });
    expect(await countSubscribed(orgOn)).toBe(1);
    expect(await countSubscribed(orgOff)).toBe(2);
  });
});
