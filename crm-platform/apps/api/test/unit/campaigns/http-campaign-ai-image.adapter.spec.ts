import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignAiImageRefusedError } from '../../../src/infra/providers/campaigns/campaign-ai-image.port';
import { HttpCampaignAiImageAdapter } from '../../../src/infra/providers/campaigns/http-campaign-ai-image.adapter';
import { imagePromptOf } from '../../../src/modules/campaigns/campaign-ai-rules';

const req = {
  provider: 'openai' as const,
  model: 'gpt-image-1',
  apiKey: 'sk-key',
  prompt: 'a picture',
  size: '1024x1024' as const,
};
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('the OpenAI image adapter', () => {
  it("asks once, with the caller's key and no redirect, and decodes the base64 picture", async () => {
    const fetchMock = reply(200, { data: [{ b64_json: png.toString('base64') }] });
    vi.stubGlobal('fetch', fetchMock);
    const out = await new HttpCampaignAiImageAdapter().generate(req);
    expect(out.mime).toBe('image/png');
    expect(out.bytes.equals(png)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-key');
    expect(init.redirect).toBe('error');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ model: 'gpt-image-1', prompt: 'a picture', n: 1, size: '1024x1024' });
  });

  it('asks the DALL-E models for base64 too, so no address from the vendor is ever fetched', async () => {
    const fetchMock = reply(200, { data: [{ b64_json: png.toString('base64') }] });
    vi.stubGlobal('fetch', fetchMock);
    await new HttpCampaignAiImageAdapter().generate({ ...req, model: 'dall-e-3' });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.response_format).toBe('b64_json');
  });

  it('turns a safety refusal into a refusal, and any other failure or an empty answer into an error', async () => {
    vi.stubGlobal('fetch', reply(400, { error: { code: 'moderation_blocked', message: 'no' } }));
    await expect(new HttpCampaignAiImageAdapter().generate(req)).rejects.toBeInstanceOf(
      CampaignAiImageRefusedError,
    );
    vi.stubGlobal('fetch', reply(500, { error: { code: 'server_error' } }));
    await expect(new HttpCampaignAiImageAdapter().generate(req)).rejects.not.toBeInstanceOf(
      CampaignAiImageRefusedError,
    );
    vi.stubGlobal('fetch', reply(200, { data: [{}] }));
    await expect(new HttpCampaignAiImageAdapter().generate(req)).rejects.toThrow('no image');
  });
});

describe('the picture prompt', () => {
  it('names the business, carries what was filled in, and bans text, logos and faces', () => {
    const p = imagePromptOf({
      provider: 'openai',
      model: 'gpt-image-1',
      businessName: 'Bloomly',
      product: 'Spring bouquets',
      offer: '15% off',
      tone: 'Warm',
      customPrompt: 'on a wooden table',
      size: '1024x1024',
    });
    expect(p).toContain('"Bloomly"');
    expect(p).toContain('Spring bouquets');
    expect(p).toContain('15% off');
    expect(p).toContain('Warm');
    expect(p).toContain('on a wooden table');
    expect(p).toMatch(/No text.*no logos.*no watermark/);
  });
});
