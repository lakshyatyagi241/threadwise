import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { Api, startHarness, type Harness } from '../contacts-attributes-tags/support';

/** Template button clicks pulled onto campaigns (WD-WABA-053): a real Postgres, Meta faked at the HTTP edge. */
let h: Harness;
let api: Api;
let seq = 0;
let calls: string[] = [];
let rules: Array<{ match: RegExp; respond: () => Response }> = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const fake: FetchLike = async (url, init) => {
    const call = `${String(init?.method)} ${url}`;
    calls.push(call);
    return (
      rules.find((r) => r.match.test(call))?.respond() ??
      json({ error: { message: `unstubbed ${call}`, code: 1 } }, 404)
    );
  };
  h.app.get(WabaHttp).fetchImpl = fake;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls = [];
  rules = [];
});

async function arrange(label: string) {
  const t = await api.signup(label);
  const n = seq++;
  const ids = { phone: `1100${n}00${n}`, waba: `2200${n}00${n}` };
  const cfg = (
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, is_primary, phone_number, display_label, credentials_json, meta_json, connected_at)
       VALUES ($1, 'waba', 'connected', true, $2, 'Support line', $3, $4, now()) RETURNING id`,
      [
        t.orgId,
        `+9191144${String(10000 + n)}`,
        h.app.get(CryptoService).encrypt(JSON.stringify({ access_token: `EAAG-token-${n}` })),
        JSON.stringify({ waba_id: ids.waba, phone_number_id: ids.phone, provider: 'meta' }),
      ],
    )
  ).rows[0];
  return { t, ids, configId: cfg.id as number };
}

describe('template click sync (WD-WABA-053)', () => {
  it('stores Meta click totals on the campaign, turning insights on once when Meta asks', async () => {
    const { WabaClickSyncService } =
      await import('../../../src/modules/whatsapp-cloud-api-waba/waba-click-sync.service');
    const clickSync = h.app.get(WabaClickSyncService);
    const x = await arrange('wc1');
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, meta_template_id, provider_config_id)
         VALUES ($1, 'promo', 'Hello', '555001', $2) RETURNING id`,
        [x.t.orgId, x.configId],
      )
    ).rows[0];
    const camp = (
      await h.owner.query(
        `INSERT INTO wpcampaigns (org_id, campaign_name, provider, template_id) VALUES ($1, 'Diwali', 'waba', $2) RETURNING id`,
        [x.t.orgId, tpl.id],
      )
    ).rows[0];
    let enabled = 0;
    let asked = 0;
    rules.push(
      {
        match: new RegExp(`GET .*/${x.ids.waba}/template_analytics`),
        respond: () => {
          asked++;
          return enabled === 0
            ? json(
                {
                  error: {
                    message: 'Template insights are not enabled for this account',
                    code: 100,
                  },
                },
                400,
              )
            : json({
                data: [
                  {
                    data_points: [
                      { template_id: '555001', clicked: [{ count: 7 }, { count: 5 }] },
                      { template_id: '555001', clicked: [{ count: 1 }] },
                      { template_id: '999999', clicked: [{ count: 100 }] },
                    ],
                  },
                ],
              });
        },
      },
      {
        match: new RegExp(`POST .*/${x.ids.waba}$`),
        respond: () => {
          enabled++;
          return json({ success: true });
        },
      },
    );
    expect(await clickSync.run({ days: 14 })).toBeGreaterThanOrEqual(1);
    const row = (
      await h.owner.query(
        `SELECT meta_clicked_count, meta_analytics_synced_at FROM wpcampaigns WHERE org_id = $1 AND id = $2`,
        [x.t.orgId, camp.id],
      )
    ).rows[0];
    expect(row.meta_clicked_count).toBe(13);
    expect(row.meta_analytics_synced_at).not.toBeNull();
    expect(enabled).toBe(1);
    expect(asked).toBe(2);
  });

  it('leaves a campaign alone when its template has no Meta id', async () => {
    const { WabaClickSyncService } =
      await import('../../../src/modules/whatsapp-cloud-api-waba/waba-click-sync.service');
    const clickSync = h.app.get(WabaClickSyncService);
    const x = await arrange('wc2');
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body) VALUES ($1, 'plain', 'Hi') RETURNING id`,
        [x.t.orgId],
      )
    ).rows[0];
    const camp = (
      await h.owner.query(
        `INSERT INTO wpcampaigns (org_id, campaign_name, provider, template_id) VALUES ($1, 'Quiet', 'waba', $2) RETURNING id`,
        [x.t.orgId, tpl.id],
      )
    ).rows[0];
    await clickSync.run({ orgId: x.t.orgId, campaignId: Number(camp.id) });
    const row = (
      await h.owner.query(
        `SELECT meta_analytics_synced_at FROM wpcampaigns WHERE org_id = $1 AND id = $2`,
        [x.t.orgId, camp.id],
      )
    ).rows[0];
    expect(row.meta_analytics_synced_at).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
