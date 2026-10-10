import { CAMPAIGN_TONE, TEMPLATE_TONE, campaignStatus, templateStatus } from './status';

describe('campaign status', () => {
  it.each([
    ['processing', 'sending'],
    ['running', 'sending'],
    ['queued', 'scheduled'],
    ['cancelled', 'paused'],
    ['failed', 'failed'],
    ['completed_with_errors', 'completed'],
    ['done', 'completed'],
  ] as const)('folds %s into %s', (raw, expected) => {
    expect(campaignStatus(raw)).toBe(expected);
  });

  it('returns null for an unknown status so the card can show the raw word', () => {
    expect(campaignStatus('mystery')).toBeNull();
  });

  it('gives every group a tone', () => {
    expect(CAMPAIGN_TONE.sending).toBe('success');
    expect(CAMPAIGN_TONE.paused).toBe('danger');
  });
});

describe('template status', () => {
  it.each([
    ['public', 'approved'],
    ['in_review', 'inReview'],
    ['submitted', 'inReview'],
    ['disabled', 'rejected'],
  ] as const)('folds %s into %s', (raw, expected) => {
    expect(templateStatus(raw)).toBe(expected);
    expect(TEMPLATE_TONE[expected]).toBeDefined();
  });

  it('returns null for an unknown status', () => {
    expect(templateStatus('draft')).toBeNull();
  });
});
