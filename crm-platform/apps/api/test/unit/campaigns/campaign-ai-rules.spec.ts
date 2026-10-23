import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_DEFAULT_COST_USD,
  aiImageCostUsd,
  briefLines,
  parseCampaignCopy,
} from '../../../src/modules/campaigns/campaign-ai-rules';

describe('Build with AI: the brief', () => {
  it('names only the fields that were filled in', () => {
    expect(
      briefLines({
        model: 'gpt-4o-mini',
        provider: 'openai',
        businessName: 'Bloomly Florals',
        goal: 'Promote a sale',
        customPrompt: 'No discounts over 20%',
      }),
    ).toEqual([
      'Business name: Bloomly Florals',
      'Campaign goal: Promote a sale',
      '',
      'Additional notes:',
      'No discounts over 20%',
    ]);
  });
});

describe('Build with AI: the answer', () => {
  it('reads the fields and cuts each to the builder limit', () => {
    const copy = parseCampaignCopy(
      JSON.stringify({
        campaign_name: 'n'.repeat(80),
        message: 'Hi {{name}}',
        footer: 'f'.repeat(90),
        button_text: 'Shop now',
        button_url: 'https://x.test/a',
        quick_replies: ['Yes', 'No', 'Later', 'Extra'],
      }),
    );
    expect(copy?.campaignName).toHaveLength(60);
    expect(copy?.footer).toHaveLength(60);
    expect(copy?.message).toBe('Hi {{name}}');
    expect(copy?.quickReplies).toEqual(['Yes', 'No', 'Later']);
  });

  it('tolerates a code fence and missing fields', () => {
    expect(parseCampaignCopy('```json\n{"message":"Hello"}\n```')).toEqual({
      campaignName: '',
      message: 'Hello',
      footer: '',
      buttonText: '',
      buttonUrl: '',
      quickReplies: [],
    });
  });

  it('refuses anything that is not a JSON object', () => {
    expect(parseCampaignCopy('Sure! Here is your campaign')).toBeNull();
    expect(parseCampaignCopy('[1,2]')).toBeNull();
    expect(parseCampaignCopy('null')).toBeNull();
  });
});

describe('what one generated picture costs the platform', () => {
  it('is the vendor price of the model, higher for the wide and tall sizes', () => {
    expect(aiImageCostUsd('gpt-image-1', '1024x1024')).toBe(0.167);
    expect(aiImageCostUsd('gpt-image-1', '1536x1024')).toBe(0.25);
    expect(aiImageCostUsd('gpt-image-1', '1024x1536')).toBe(0.25);
    expect(aiImageCostUsd('dall-e-3', '1024x1024')).toBe(0.04);
    expect(aiImageCostUsd('dall-e-3', '1536x1024')).toBe(0.08);
    expect(aiImageCostUsd('dall-e-2', '1024x1024')).toBe(0.02);
  });

  it('ignores case and stray spaces in the model name', () => {
    expect(aiImageCostUsd('  GPT-Image-1 ', '1024x1024')).toBe(0.167);
  });

  it('is the standard 1024px price for a model that is not in the table, and never a free picture', () => {
    expect(aiImageCostUsd('some-new-model', '1024x1024')).toBe(AI_IMAGE_DEFAULT_COST_USD);
    expect(AI_IMAGE_DEFAULT_COST_USD).toBe(0.25);
    // A request cannot reach a property of the table's object by naming the model after it.
    for (const model of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(aiImageCostUsd(model, '1024x1024')).toBe(AI_IMAGE_DEFAULT_COST_USD);
    }
  });
});
