import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Api, bearer, startHarness, type Harness } from '../contacts-attributes-tags/support';
import { HttpCampaignAiAdapter } from '../../../src/infra/providers/campaigns/http-campaign-ai.adapter';
import {
  CAMPAIGN_AI_IMAGE_PORT,
  CampaignAiImageRefusedError,
  type CampaignAiImagePort,
} from '../../../src/infra/providers/campaigns/campaign-ai-image.port';
import { AiKeyResolver, AiTokenMeter } from '../../../src/modules/ai-keys-usage-admin';
import { MarketingMediaService } from '../../../src/modules/broadcasts';

/**
 * The rest of "Build with AI": a template draft from a brief (TW-TPL-016) and a picture for a campaign. The real app and a real
 * Postgres, the vendors stubbed (nothing leaves the machine).
 */
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
const cloud = () => vi.spyOn(h.app.get(MarketingMediaService), 'canStore').mockResolvedValue(true);
const withKey = (source: 'workspace' | 'admin' = 'workspace') =>
  vi
    .spyOn(h.app.get(AiKeyResolver), 'resolve')
    .mockResolvedValue({ key: 'sk-secret-key', source, model: null });

const tplBrief = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  businessName: 'Bloomly Florals',
  purpose: 'Order update',
};

describe('POST /v2/templates/ai-generate (TW-TPL-016)', () => {
  const post = (t: { admin: string }, body: object) =>
    api.http().post('/v2/templates/ai-generate').set(bearer(t.admin)).send(body);

  it('answers 422 CAMP_AI_NO_KEY while no key is active for the vendor', async () => {
    const t = await api.signup('tplai1');
    const res = await post(t, tplBrief);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CAMP_AI_NO_KEY');
  });

  it('refuses a brief without a business name, an unknown vendor, or a bad language', async () => {
    const t = await api.signup('tplai2');
    expect((await post(t, { ...tplBrief, businessName: '' })).status).toBe(422);
    expect((await post(t, { ...tplBrief, provider: 'mistral' })).status).toBe(422);
    expect((await post(t, { ...tplBrief, language: 'english' })).status).toBe(422);
    expect((await post(t, { ...tplBrief, metaCategory: 'AUTHENTICATION' })).status).toBe(422);
  });

  it('returns a draft cut to what Meta takes, never the key, and writes the tokens to the ledger', async () => {
    const t = await api.signup('tplai3');
    const resolve = withKey();
    const seen: Array<{ apiKey: string; userPrompt: string; systemPrompt: string }> = [];
    const complete = vi
      // The template module and the campaign module each provide the stateless adapter: spy on the class so both are covered.
      .spyOn(HttpCampaignAiAdapter.prototype, 'complete')
      .mockImplementation((req) => {
        seen.push(req);
        return Promise.resolve({
          text:
            '```json\n' +
            JSON.stringify({
              template_name: 'Order Update – Spring!',
              header: 'Order {{1}} update',
              body: 'Hi {{1}}, your order is on its way.',
              footer: 'Reply STOP {{2}}',
              buttons: [
                { type: 'visit_website', text: 'Track order', value: 'https://bloomly.test/track' },
                { type: 'call_phone', text: 'Call us', value: '+91 98765 43210' },
                { type: 'visit_website', text: 'Bad link', value: 'javascript:alert(1)' },
                { type: 'quick_reply', text: 'Thanks', value: '' },
              ],
            }) +
            '\n```',
          promptTokens: 150,
          completionTokens: 90,
        });
      });
    try {
      const res = await post(t, { ...tplBrief, tone: 'Friendly', language: 'en_GB' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.model).toBe('gpt-4o-mini');
      expect(res.body.template).toEqual({
        name: 'order_update_spring',
        header: 'Order update',
        body: 'Hi {{1}}, your order is on its way.',
        footer: 'Reply STOP',
        buttons: [
          { type: 'URL', text: 'Track order', url: 'https://bloomly.test/track' },
          { type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: '+919876543210' },
        ],
      });
      expect(JSON.stringify(res.body)).not.toContain('sk-secret-key');
      expect(seen[0]?.apiKey).toBe('sk-secret-key');
      expect(seen[0]?.userPrompt).toContain('Business name: Bloomly Florals');
      expect(seen[0]?.userPrompt).toContain('Language: en_GB');
      expect(seen[0]?.userPrompt).toContain('Tone: Friendly');
      const ledger = await h.owner.query(
        `SELECT billed_against, total_tokens FROM ai_token_usage WHERE org_id = $1`,
        [t.orgId],
      );
      expect(ledger.rows).toEqual([{ billed_against: 'workspace', total_tokens: 240 }]);
    } finally {
      resolve.mockRestore();
      complete.mockRestore();
    }
  });

  it('answers 422 CAMP_AI_BAD_JSON for prose or an empty body, and 502 CAMP_AI_PROVIDER_FAILED for an empty answer', async () => {
    const t = await api.signup('tplai4');
    const resolve = withKey();
    const reply = (text: string) =>
      vi
        .spyOn(HttpCampaignAiAdapter.prototype, 'complete')
        .mockResolvedValue({ text, promptTokens: 0, completionTokens: 0 });
    try {
      let spy = reply('Sure! Here is your template');
      expect(code(await post(t, tplBrief))).toBe('CAMP_AI_BAD_JSON');
      spy.mockRestore();
      spy = reply(JSON.stringify({ template_name: 'x', body: '   ' }));
      expect(code(await post(t, tplBrief))).toBe('CAMP_AI_BAD_JSON');
      spy.mockRestore();
      spy = reply('');
      const empty = await post(t, tplBrief);
      expect(empty.status).toBe(502);
      expect(code(empty)).toBe('CAMP_AI_PROVIDER_FAILED');
      spy.mockRestore();
    } finally {
      resolve.mockRestore();
    }
  });

  it("answers 422 CAMP_AI_LIMIT_REACHED when the platform key's monthly allowance is used up", async () => {
    const t = await api.signup('tplai5');
    const resolve = withKey('admin');
    const guard = vi.spyOn(h.app.get(AiTokenMeter), 'guard').mockRejectedValue(new Error('used'));
    try {
      const res = await post(t, tplBrief);
      expect(res.status).toBe(422);
      expect(code(res)).toBe('CAMP_AI_LIMIT_REACHED');
    } finally {
      guard.mockRestore();
      resolve.mockRestore();
    }
  });
});

describe('POST /v2/campaigns/ai-image', () => {
  const imgBrief = {
    businessName: 'Bloomly Florals',
    product: 'Spring bouquets',
    offer: '15% off',
  };
  const post = (t: { admin: string }, body: object) =>
    api.http().post('/v2/campaigns/ai-image').set(bearer(t.admin)).send(body);
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const stored = {
    url: 'https://cdn.test/marketing/1/ai.png',
    name: 'ai.png',
    mime: 'image/png',
    kind: 'image' as const,
    size: png.length,
  };

  it('answers 422 CAMP_AI_NO_KEY while no OpenAI key is active', async () => {
    const t = await api.signup('img1');
    const res = await post(t, imgBrief);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('CAMP_AI_NO_KEY');
  });

  it('refuses a brief without a business name, another vendor, or an unknown size', async () => {
    const t = await api.signup('img2');
    expect((await post(t, { ...imgBrief, businessName: '' })).status).toBe(422);
    expect((await post(t, { ...imgBrief, provider: 'anthropic' })).status).toBe(422);
    expect((await post(t, { ...imgBrief, size: '640x480' })).status).toBe(422);
  });

  it('draws one picture, stores it as a marketing upload, never returns the key, and writes the ledger', async () => {
    const t = await api.signup('img3');
    const resolve = withKey();
    const storage = cloud();
    const seen: Array<{ apiKey: string; prompt: string; size: string; model: string }> = [];
    const generate = vi
      .spyOn(h.app.get<CampaignAiImagePort>(CAMPAIGN_AI_IMAGE_PORT), 'generate')
      .mockImplementation((req) => {
        seen.push(req);
        return Promise.resolve({ bytes: png, mime: 'image/png' });
      });
    const uploads: Array<{ originalname: string; buffer: Buffer }> = [];
    const upload = vi
      .spyOn(h.app.get(MarketingMediaService), 'upload')
      .mockImplementation((file) => {
        uploads.push(file!);
        return Promise.resolve(stored);
      });
    try {
      const res = await post(t, { ...imgBrief, size: '1536x1024', customPrompt: 'a spring table' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({ image: stored, model: 'gpt-image-1' });
      expect(JSON.stringify(res.body)).not.toContain('sk-secret-key');
      expect(seen[0]).toMatchObject({
        apiKey: 'sk-secret-key',
        size: '1536x1024',
        model: 'gpt-image-1',
      });
      expect(seen[0]?.prompt).toContain('Bloomly Florals');
      expect(seen[0]?.prompt).toContain('a spring table');
      expect(seen[0]?.prompt).toContain('No text');
      expect(uploads).toHaveLength(1);
      expect(uploads[0]?.originalname).toMatch(/^ai-\d+\.png$/);
      expect(uploads[0]?.buffer.equals(png)).toBe(true);
      const ledger = await h.owner.query(
        `SELECT billed_against, total_tokens FROM ai_token_usage WHERE org_id = $1`,
        [t.orgId],
      );
      expect(ledger.rows).toEqual([{ billed_against: 'workspace', total_tokens: 4000 }]);
    } finally {
      storage.mockRestore();
      resolve.mockRestore();
      generate.mockRestore();
      upload.mockRestore();
    }
  });

  it('answers 422 CAMP_AI_IMAGE_REFUSED when the vendor refuses the prompt, with nothing stored or charged', async () => {
    const t = await api.signup('img4');
    const resolve = withKey();
    const storage = cloud();
    const generate = vi
      .spyOn(h.app.get<CampaignAiImagePort>(CAMPAIGN_AI_IMAGE_PORT), 'generate')
      .mockRejectedValue(new CampaignAiImageRefusedError('safety'));
    const upload = vi.spyOn(h.app.get(MarketingMediaService), 'upload');
    try {
      const res = await post(t, imgBrief);
      expect(res.status).toBe(422);
      expect(code(res)).toBe('CAMP_AI_IMAGE_REFUSED');
      expect(upload).not.toHaveBeenCalled();
      const ledger = await h.owner.query(`SELECT 1 FROM ai_token_usage WHERE org_id = $1`, [
        t.orgId,
      ]);
      expect(ledger.rows).toHaveLength(0);
    } finally {
      storage.mockRestore();
      resolve.mockRestore();
      generate.mockRestore();
      upload.mockRestore();
    }
  });

  it('answers 502 CAMP_AI_PROVIDER_FAILED when the vendor fails, and 422 CAMP_AI_LIMIT_REACHED over the allowance', async () => {
    const t = await api.signup('img5');
    const resolve = withKey('admin');
    const storage = cloud();
    const port = h.app.get<CampaignAiImagePort>(CAMPAIGN_AI_IMAGE_PORT);
    const guard = vi.spyOn(h.app.get(AiTokenMeter), 'guard').mockResolvedValue(undefined);
    const generate = vi.spyOn(port, 'generate').mockRejectedValue(new Error('boom'));
    try {
      const failed = await post(t, imgBrief);
      expect(failed.status).toBe(502);
      expect(code(failed)).toBe('CAMP_AI_PROVIDER_FAILED');
      guard.mockRejectedValue(new Error('used'));
      const over = await post(t, imgBrief);
      expect(over.status).toBe(422);
      expect(code(over)).toBe('CAMP_AI_LIMIT_REACHED');
    } finally {
      guard.mockRestore();
      generate.mockRestore();
      storage.mockRestore();
      resolve.mockRestore();
    }
  });

  it('draws nothing, charges nothing and says why when the workspace storage is local (a provider could not fetch the file)', async () => {
    const t = await api.signup('img6');
    const resolve = withKey();
    const generate = vi.spyOn(h.app.get<CampaignAiImagePort>(CAMPAIGN_AI_IMAGE_PORT), 'generate');
    try {
      const res = await post(t, imgBrief);
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain('object storage');
      expect(generate).not.toHaveBeenCalled();
      const ledger = await h.owner.query(`SELECT 1 FROM ai_token_usage WHERE org_id = $1`, [
        t.orgId,
      ]);
      expect(ledger.rows).toHaveLength(0);
    } finally {
      generate.mockRestore();
      resolve.mockRestore();
    }
  });
});
