import { describe, expect, it } from 'vitest';
import {
  v1CreateTemplateSchema,
  v1SendTemplateSchema,
  v1SubscribersQuerySchema,
  v1UpdateTemplateSchema,
  v1EnrollSchema,
} from '@crm/contracts';
import {
  buttonsOfInput,
  metaCategoryOfInput,
  publicButtonOf,
} from '../../../src/modules/developer-rest-api-v1/resources/automation/templates/template-public.mapper';
import {
  bodyValuesOf,
  recipientDigits,
  renderBody,
  sendBlockOf,
} from '../../../src/modules/developer-rest-api-v1/resources/automation/templates/template-send.rules';
import { flowStatusOf } from '../../../src/modules/developer-rest-api-v1/resources/automation/flows/flows.v1.mapper';

describe('template category input (TW-API-031, 032)', () => {
  it('reads Meta ids, slugs in any case, and treats industry buckets and junk as utility', () => {
    expect(metaCategoryOfInput(1)).toBe('MARKETING');
    expect(metaCategoryOfInput('2')).toBe('AUTHENTICATION');
    expect(metaCategoryOfInput(3)).toBe('UTILITY');
    expect(metaCategoryOfInput('  Marketing ')).toBe('MARKETING');
    expect(metaCategoryOfInput('travel')).toBe('UTILITY');
    expect(metaCategoryOfInput('whatever')).toBe('UTILITY');
  });
});

describe('template buttons input (TW-API-032 rule 7)', () => {
  it('caps CTA buttons and quick replies at three, CTA first, and skips non-objects and blank replies', () => {
    const out = buttonsOfInput(
      [
        { type: 'visit_website', text: 'Site', value: 'https://a.test' },
        'junk',
        { type: 'call_phone', text: 'Call', value: '9811200001', country_code: '91' },
        { type: 'quick_reply', text: 'Yes' },
        { type: 'quick_reply', text: 'No' },
      ],
      ['  ', { text: 'Maybe' }, 'Later'],
    );
    expect(out).toHaveLength(3);
    expect(out.map((b) => b.type)).toEqual(['URL', 'PHONE_NUMBER', 'QUICK_REPLY']);
    expect(out[0]).toMatchObject({ url: 'https://a.test', text: 'Site' });
    expect(out[1]).toMatchObject({ phone_number: '+919811200001' });
  });

  it('appends quick replies after the CTA buttons', () => {
    const out = buttonsOfInput(undefined, ['One', { text: 'Two' }, '']);
    expect(out).toEqual([
      { type: 'QUICK_REPLY', text: 'One' },
      { type: 'QUICK_REPLY', text: 'Two' },
    ]);
  });

  it('shows stored buttons in Reference vocabulary', () => {
    expect(publicButtonOf({ type: 'URL', text: 'Go', url: 'https://a.test' })).toEqual({
      type: 'visit_website',
      text: 'Go',
      value: 'https://a.test',
    });
    expect(publicButtonOf({ type: 'QUICK_REPLY', text: 'Hi' })).toEqual({
      type: 'quick_reply',
      text: 'Hi',
    });
  });
});

describe('template write validation (TW-API-032, 034)', () => {
  it('requires the body only for a literal standard type on create, always on update', () => {
    expect(
      v1CreateTemplateSchema.safeParse({
        template_name: 'a',
        category: 3,
        template_type: 'standard',
      }).success,
    ).toBe(false);
    expect(v1CreateTemplateSchema.safeParse({ template_name: 'a', category: 3 }).success).toBe(
      true,
    );
    expect(v1UpdateTemplateSchema.safeParse({ template_name: 'a', category: 3 }).success).toBe(
      false,
    );
  });

  it('wants latitude and longitude together and inside their ranges', () => {
    const base = { template_name: 'a', category: 3, template_body: 'x' };
    expect(v1CreateTemplateSchema.safeParse({ ...base, latitude: '10' }).success).toBe(false);
    expect(v1CreateTemplateSchema.safeParse({ ...base, longitude: 10 }).success).toBe(false);
    expect(v1CreateTemplateSchema.safeParse({ ...base, latitude: 91, longitude: 10 }).success).toBe(
      false,
    );
    expect(
      v1CreateTemplateSchema.safeParse({ ...base, latitude: 10, longitude: -181 }).success,
    ).toBe(false);
    expect(v1CreateTemplateSchema.safeParse({ ...base, latitude: 10, longitude: 20 }).success).toBe(
      true,
    );
  });

  it('refuses a code expiry outside 1 to 90 and decodes buttons sent as JSON text', () => {
    const base = { template_name: 'a', category: 3, template_body: 'x' };
    expect(
      v1CreateTemplateSchema.safeParse({ ...base, code_expiration_minutes: 120 }).success,
    ).toBe(false);
    const parsed = v1CreateTemplateSchema.parse({
      ...base,
      buttons: '[{"type":"quick_reply","text":"Y"}]',
    });
    expect(parsed.buttons).toEqual([{ type: 'quick_reply', text: 'Y' }]);
  });

  it('treats a blank category as missing', () => {
    expect(
      v1CreateTemplateSchema.safeParse({ template_name: 'a', category: '   ', template_body: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('template send input (TW-API-036)', () => {
  it('takes a list or a 1-indexed map for body, sorted by number, and only strings', () => {
    expect(bodyValuesOf(['a', 'b'])).toEqual(['a', 'b']);
    expect(bodyValuesOf({ '2': 'B', '1': 'A', '10': 'J' })).toEqual(['A', 'B', 'J']);
    expect(bodyValuesOf(undefined)).toEqual([]);
    expect(v1SendTemplateSchema.safeParse({ to: '+919811200001', body: [123] }).success).toBe(
      false,
    );
    expect(v1SendTemplateSchema.safeParse({ to: '+919811200001', body: [true] }).success).toBe(
      false,
    );
    expect(
      v1SendTemplateSchema.safeParse({ to: '+919811200001', body: { '1': 'x' } }).success,
    ).toBe(true);
  });

  it('bounds the fields as Reference did', () => {
    expect(v1SendTemplateSchema.safeParse({ to: 'x'.repeat(33) }).success).toBe(false);
    expect(v1SendTemplateSchema.safeParse({ to: '1' }).success).toBe(true);
    expect(v1SendTemplateSchema.safeParse({ to: '1', header_media_url: 'not a url' }).success).toBe(
      false,
    );
    const b = v1SendTemplateSchema.parse({ to: '1', buttons: [{}] }).buttons;
    expect(b).toEqual([{ index: 0, sub_type: 'url', value: '' }]);
  });

  it('strips everything but digits from the recipient', () => {
    expect(recipientDigits('+91 98112-00001')).toBe('919811200001');
  });

  it('renders the body with the values at their positions and leaves unfilled placeholders', () => {
    expect(renderBody('Hi {{1}}, order {{2}} for {{3}}', ['1', '2', '3'], ['Ana', '42'])).toBe(
      'Hi Ana, order 42 for {{3}}',
    );
  });

  it('orders the gates as Reference did: approval, pause, quality', () => {
    const t = {
      status: 'approved',
      metaStatus: 'APPROVED',
      pausedUntil: null,
      qualityScore: 'GREEN',
      templateType: 'standard',
      parameterFormat: 'POSITIONAL',
      attachmentType: null,
    };
    const now = new Date('2026-10-06T10:00:00Z');
    expect(sendBlockOf(t, now)).toBeNull();
    expect(sendBlockOf({ ...t, qualityScore: 'UNKNOWN' }, now)).toBeNull();
    expect(sendBlockOf({ ...t, qualityScore: 'RED' }, now)?.code).toBe('quality_floor');
    expect(sendBlockOf({ ...t, metaStatus: 'PENDING', qualityScore: 'RED' }, now)?.code).toBe(
      'not_approved',
    );
    expect(sendBlockOf({ ...t, status: 'draft' }, now)?.code).toBe('not_approved');
    expect(
      sendBlockOf({ ...t, pausedUntil: new Date('2026-10-07T00:00:00Z'), qualityScore: 'RED' }, now)
        ?.code,
    ).toBe('paused');
    expect(sendBlockOf({ ...t, pausedUntil: new Date('2026-10-05T00:00:00Z') }, now)).toBeNull();
  });
});

describe('flows (TW-API-044 to 047)', () => {
  it('derives Reference status from the two flags', () => {
    expect(flowStatusOf({ published: false, active: true })).toBe('draft');
    expect(flowStatusOf({ published: true, active: true })).toBe('live');
    expect(flowStatusOf({ published: true, active: false })).toBe('paused');
  });

  it('clamps the subscribers limit like Reference: default 100, 500 becomes 200, 0 or text becomes 1', () => {
    expect(v1SubscribersQuerySchema.parse({}).limit).toBe(100);
    expect(v1SubscribersQuerySchema.parse({ limit: '500' }).limit).toBe(200);
    expect(v1SubscribersQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(v1SubscribersQuerySchema.parse({ limit: 'abc' }).limit).toBe(1);
    expect(v1SubscribersQuerySchema.parse({ per_page: '7' }).limit).toBe(7);
    expect(v1SubscribersQuerySchema.safeParse({ page: 2 }).success).toBe(false);
  });

  it('needs a contact id or a phone to enrol', () => {
    expect(v1EnrollSchema.safeParse({}).success).toBe(false);
    expect(v1EnrollSchema.safeParse({ phone: '+919811200001' }).success).toBe(true);
    expect(v1EnrollSchema.safeParse({ contact_id: '3' }).success).toBe(false);
    expect(
      v1EnrollSchema.safeParse({ contact_id: '8a0d3e0e-2c1b-4f55-9f5e-0a8a3c3b9a11' }).success,
    ).toBe(true);
  });
});
