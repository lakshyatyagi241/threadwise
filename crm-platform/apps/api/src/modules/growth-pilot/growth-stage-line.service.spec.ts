import { describe, expect, it } from 'vitest';
import { stageLineBody } from './growth-stage-line.service';

describe('stageLineBody', () => {
  it('says the AI moved the contact, with both stages', () => {
    expect(stageLineBody({ action: 'auto', fromLabel: 'Lead', toLabel: 'Ready to buy' })).toBe(
      'AI read the chat and moved this contact from Lead to Ready to buy',
    );
  });

  it('says the change was undone and where the contact is again', () => {
    expect(stageLineBody({ action: 'undone', fromLabel: 'Ready to buy', toLabel: 'Lead' })).toBe(
      'Stage change undone: back to Lead',
    );
  });
});
