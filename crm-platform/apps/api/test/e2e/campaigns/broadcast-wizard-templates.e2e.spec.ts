import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, buildLab, startHarness, wiz, world, type Lab } from './broadcast-wizard.support';

/**
 * The templates a campaign may use, from the two doors: the guided wizard's list and the classic builder's pickers. They hold the same
 * set.
 */
let lab: Lab;

beforeAll(async () => {
  lab = buildLab(await startHarness());
}, 240_000);

afterAll(async () => {
  await lab?.h.stop();
});

const owner = () => lab.h.owner;

/** An approved template of another kind on the same number: an SMS one, an OTP one. */
async function extraTemplate(
  orgId: number,
  config: string,
  o: { channel?: string; type?: string; name: string },
) {
  const cfg = (
    await owner().query(`SELECT id FROM wa_provider_configs WHERE org_id = $1 AND uuid = $2`, [
      orgId,
      config,
    ])
  ).rows[0] as { id: number };
  const t = await owner().query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, language, meta_category, category, provider_config_id, channel)
     VALUES ($1, $2, 'Your code is {{1}}', $3, 'approved', 'en_US', 'MARKETING', 'marketing', $4, $5) RETURNING uuid`,
    [orgId, o.name, o.type ?? 'standard', cfg.id, o.channel ?? 'waba'],
  );
  return t.rows[0].uuid as string;
}

const wizardList = async (token: string) =>
  (await wiz(lab, token).get('/templates')).body.data as Array<{
    id: string;
    senderKey: string | null;
  }>;
const builderList = async (token: string) =>
  (
    (await lab.api.http().get('/v2/campaigns/builder').set(bearer(token))).body.templates as Array<{
      id: string;
    }>
  ).map((t) => t.id);

describe('the templates a campaign may use', () => {
  it('the wizard and the classic builder list the same approved templates, and neither lists an SMS or an OTP one', async () => {
    const w = await world(lab, 'tpl-same');
    const sms = await extraTemplate(w.t.orgId, w.config, { name: 'sms_one', channel: 'sms' });
    const otp = await extraTemplate(w.t.orgId, w.config, { name: 'otp_one', type: 'auth' });
    const second = await extraTemplate(w.t.orgId, w.config, { name: 'second_one' });

    const wizard = (await wizardList(w.t.admin)).map((t) => t.id).sort();
    const builder = (await builderList(w.t.admin)).sort();
    expect(wizard).toEqual([w.template, second].sort());
    expect(builder).toEqual(wizard);
    expect(wizard).not.toContain(sms);
    expect(wizard).not.toContain(otp);
  });
});
