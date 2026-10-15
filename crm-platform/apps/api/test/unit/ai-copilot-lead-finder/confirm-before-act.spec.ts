import { describe, expect, it } from 'vitest';
import { AFFIRMATIVE, NEGATIVE, looksLikePhone, maskPhone } from '../../../src/modules/ai-copilot-lead-finder/ai-crm-copilot.service';

describe('AI CRM Copilot: confirm-before-act reply matching', () => {
  it.each(['yes', 'Yes', 'y', 'yeah', 'yep', 'ok', 'okay', 'confirm', 'confirmed', 'sure', 'do it', 'go', 'proceed'])(
    'treats "%s" as an affirmative confirmation',
    (reply) => {
      expect(AFFIRMATIVE.test(reply)).toBe(true);
      expect(NEGATIVE.test(reply)).toBe(false);
    },
  );

  it.each(['no', 'No', 'n', 'nope', 'cancel', 'stop', "don't", 'dont'])(
    'treats "%s" as a cancellation',
    (reply) => {
      expect(NEGATIVE.test(reply)).toBe(true);
      expect(AFFIRMATIVE.test(reply)).toBe(false);
    },
  );

  it('does not treat an ordinary follow-up message as either — it must go back to the model, not auto-run the pending write', () => {
    expect(AFFIRMATIVE.test('yesterday I added that contact already')).toBe(false);
    expect(NEGATIVE.test('notify the team too')).toBe(false);
  });
});

describe('AI CRM Copilot: phone masking in the audit log', () => {
  it('keeps only the last 4 digits', () => {
    expect(maskPhone('+919812345678')).toBe('********5678');
  });

  it('leaves a short value alone rather than masking everything', () => {
    expect(maskPhone('1234')).toBe('1234');
  });

  it('strips non-digit characters before masking', () => {
    expect(maskPhone('+91 98123-45678')).toBe('********5678');
  });
});

describe('AI CRM Copilot: masking a phone-shaped value regardless of its argument name', () => {
  // `send_message`'s `to` argument is "a phone number OR a contact name", so it isn't masked by key name
  // alone (unlike `phone`/`contact_phone`/`buyer_phone`) — it must be masked by shape instead.
  it('recognizes a phone number', () => {
    expect(looksLikePhone('+91 9812345678')).toBe(true);
    expect(looksLikePhone('9812345678')).toBe(true);
  });

  it('does not mistake a contact name for a phone number', () => {
    expect(looksLikePhone('Priya Sharma')).toBe(false);
    expect(looksLikePhone('Acme Corp')).toBe(false);
  });

  it('does not mistake a short numeric id for a phone number', () => {
    expect(looksLikePhone('42')).toBe(false);
  });
});
