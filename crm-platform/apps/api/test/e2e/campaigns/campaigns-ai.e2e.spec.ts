import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Api, bearer, startHarness, type Harness } from '../contacts-attributes-tags/support';
import {
  CAMPAIGN_AI_PORT,
  type CampaignAiPort,
} from '../../../src/infra/providers/campaigns/campaign-ai.port';
import { AiKeyResolver } from '../../../src/modules/ai-keys-usage-admin';

/** "Build with AI" on the campaign builder (WD-CAMP-002): the real app and a real Postgres, the vendor stubbed. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string; error?: { code?: string } } }) =>
  res.body.code ?? res.body.error?.code;
const brief = {
  model: 'gpt-4o-mini',
  provider: 'openai',
  businessName: 'Bloomly Florals',
  goal: 'Promote a sale',
};

describe('POST /v2/campaigns/ai-generate (WD-CAMP-002)', () => {
  it('answers 422 CAMP_AI_NO_KEY while no key is active for the vendor', async () => {
    const t = await api.signup('campai1');
    const res = await api.http().post('/v2/campaigns/ai-generate').set(bearer(t.admin)).send(brief);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CAMP_AI_NO_KEY');
  });

  it('refuses a brief without a business name or with an unknown vendor', async () => {
    const t = await api.signup('campai2');
    const post = (b: object) =>
      api.http().post('/v2/campaigns/ai-generate').set(bearer(t.admin)).send(b);
    expect((await post({ ...brief, businessName: '' })).status).toBe(422);
    expect((await post({ ...brief, provider: 'mistral' })).status).toBe(422);
  });

  it('returns the copy cut to the builder limits and never the key', async () => {
    const t = await api.signup('campai3');
    const resolver = h.app.get(AiKeyResolver);
    const resolve = vi
      .spyOn(resolver, 'resolve')
      .mockResolvedValue({ key: 'sk-secret-key', source: 'workspace', model: null });
    const port = h.app.get<CampaignAiPort>(CAMPAIGN_AI_PORT);
    const seen: Array<{ apiKey: string; userPrompt: string }> = [];
    const complete = vi.spyOn(port, 'complete').mockImplementation((req) => {
      seen.push({ apiKey: req.apiKey, userPrompt: req.userPrompt });
      return Promise.resolve({
        text: JSON.stringify({
          campaign_name: 'spring-sale',
          message: 'Hi {{name}}, 15% off this weekend',
          footer: 'Reply STOP to opt out',
          button_text: 'Shop now',
          button_url: 'https://bloomly.test/spring',
          quick_replies: ['Yes please', 'Not now', 'Later', 'A fourth'],
        }),
        promptTokens: 120,
        completionTokens: 80,
      });
    });
    try {
      const res = await api
        .http()
        .post('/v2/campaigns/ai-generate')
        .set(bearer(t.admin))
        .send({ ...brief, tone: 'Friendly' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.model).toBe('gpt-4o-mini');
      expect(res.body.campaign).toEqual({
        campaignName: 'spring-sale',
        message: 'Hi {{name}}, 15% off this weekend',
        footer: 'Reply STOP to opt out',
        buttonText: 'Shop now',
        buttonUrl: 'https://bloomly.test/spring',
        quickReplies: ['Yes please', 'Not now', 'Later'],
      });
      expect(JSON.stringify(res.body)).not.toContain('sk-secret-key');
      expect(seen[0]?.apiKey).toBe('sk-secret-key');
      expect(seen[0]?.userPrompt).toContain('Business name: Bloomly Florals');
      expect(seen[0]?.userPrompt).toContain('Tone: Friendly');
      const ledger = await h.owner.query(
        `SELECT billed_against, total_tokens FROM ai_token_usage WHERE org_id = $1`,
        [t.orgId],
      );
      expect(ledger.rows).toEqual([{ billed_against: 'workspace', total_tokens: 200 }]);
    } finally {
      resolve.mockRestore();
      complete.mockRestore();
    }
  });

  it('answers 422 CAMP_AI_BAD_JSON for prose and 502 CAMP_AI_PROVIDER_FAILED for an empty answer', async () => {
    const t = await api.signup('campai4');
    const resolve = vi
      .spyOn(h.app.get(AiKeyResolver), 'resolve')
      .mockResolvedValue({ key: 'sk-x', source: 'workspace', model: null });
    const port = h.app.get<CampaignAiPort>(CAMPAIGN_AI_PORT);
    const reply = (text: string) =>
      vi.spyOn(port, 'complete').mockResolvedValue({ text, promptTokens: 0, completionTokens: 0 });
    const send = () =>
      api.http().post('/v2/campaigns/ai-generate').set(bearer(t.admin)).send(brief);
    try {
      let spy = reply('Sure! Here is your campaign');
      const prose = await send();
      expect(prose.status).toBe(422);
      expect(code(prose)).toBe('CAMP_AI_BAD_JSON');
      spy.mockRestore();
      spy = reply('');
      const empty = await send();
      expect(empty.status).toBe(502);
      expect(code(empty)).toBe('CAMP_AI_PROVIDER_FAILED');
      spy.mockRestore();
    } finally {
      resolve.mockRestore();
    }
  });
});
