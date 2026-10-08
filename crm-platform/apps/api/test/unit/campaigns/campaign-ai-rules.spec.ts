import { describe, expect, it } from 'vitest';
import { briefLines, parseCampaignCopy } from '../../../src/modules/campaigns/campaign-ai-rules';

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
