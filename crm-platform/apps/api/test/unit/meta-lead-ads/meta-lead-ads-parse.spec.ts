import { describe, expect, it } from 'vitest';
import {
  isoTime,
  mergeSubscribedFields,
  normaliseCheckboxes,
  normaliseForm,
  normaliseLead,
  normaliseQuestions,
  subscribedFieldsOf,
} from '../../../src/infra/providers/meta-lead-ads/meta-lead-ads.parse';

describe('Meta times', () => {
  it('reads the offset without a colon that Graph writes', () => {
    expect(isoTime('2026-10-16T08:30:00+0000')).toBe('2026-10-16T08:30:00.000Z');
    expect(isoTime('2026-10-16T14:00:00+0530')).toBe('2026-10-16T08:30:00.000Z');
    expect(isoTime('2026-10-16T08:30:00Z')).toBe('2026-10-16T08:30:00.000Z');
  });
  it('is null for anything that is not a time', () => {
    expect(isoTime(null)).toBeNull();
    expect(isoTime('')).toBeNull();
    expect(isoTime('yesterday')).toBeNull();
    expect(isoTime({})).toBeNull();
  });
});

describe('a form', () => {
  const raw = {
    id: 5001,
    name: 'Diwali form',
    status: 'ACTIVE',
    locale: 'en_US',
    leads_count: 42,
    created_time: '2026-10-01T10:00:00+0000',
    questions: [
      { key: 'full_name', label: 'Full name', type: 'full_name' },
      { key: 'full_name', label: 'duplicate', type: 'CUSTOM' },
      { key: 'budget', label: 'Budget?' },
      { label: 'no key' },
    ],
    custom_disclaimer: {
      checkboxes: [
        { key: 'cb1', text: 'I agree to be contacted.', is_required: true },
        { key: 'cb2', text: '   ' },
        { text: 'no key' },
      ],
    },
    privacy_policy: { url: 'https://example.test/privacy' },
  };

  it('is read into the port’s shape', () => {
    expect(normaliseForm(raw)).toEqual({
      id: '5001',
      name: 'Diwali form',
      status: 'ACTIVE',
      locale: 'en_US',
      leadsCount: 42,
      createdTime: '2026-10-01T10:00:00.000Z',
      questions: [
        { key: 'full_name', label: 'Full name', type: 'FULL_NAME' },
        { key: 'budget', label: 'Budget?', type: 'CUSTOM' },
      ],
      checkboxes: [{ key: 'cb1', text: 'I agree to be contacted.', required: true }],
      privacyPolicyUrl: 'https://example.test/privacy',
    });
  });

  it('takes questions from a Graph edge too, and falls back for a form with little on it', () => {
    expect(
      normaliseQuestions({ data: [{ key: 'a', label: 'A', type: 'EMAIL' }] }.data),
    ).toHaveLength(1);
    expect(normaliseForm({ id: '7', questions: { data: [{ key: 'a' }] } })).toMatchObject({
      name: '7',
      status: null,
      leadsCount: null,
      questions: [{ key: 'a', label: 'a', type: 'CUSTOM' }],
      checkboxes: [],
      privacyPolicyUrl: null,
    });
    expect(normaliseForm({ name: 'no id' })).toBeNull();
    expect(normaliseForm(null)).toBeNull();
  });

  it('keeps a consent box only with wording', () => {
    expect(normaliseCheckboxes(undefined)).toEqual([]);
    expect(
      normaliseCheckboxes({ checkboxes: [{ key: 'k', text: 'x'.repeat(5000) }] })[0]?.text,
    ).toHaveLength(2000);
  });
});

describe('a lead', () => {
  it('is read with its answers, ids, names and ticked boxes', () => {
    const l = normaliseLead({
      id: '9001',
      created_time: '2026-10-16T08:30:00+0000',
      form_id: '5001',
      ad_id: 'a1',
      ad_name: 'Ad',
      adset_id: 's1',
      adset_name: 'Set',
      campaign_id: 'c1',
      campaign_name: 'Camp',
      platform: 'ig',
      is_organic: false,
      field_data: [
        { name: 'full_name', values: ['Asha Rao'] },
        { name: 'multi', values: ['a', 'b', ''] },
        { name: 'empty', values: [] },
        { values: ['no name'] },
      ],
      custom_disclaimer_responses: [
        { checkbox_key: 'cb1', is_checked: true },
        { checkbox_key: 'cb2', is_checked: false },
        { is_checked: true },
      ],
    });
    expect(l).toMatchObject({
      id: '9001',
      createdTime: '2026-10-16T08:30:00.000Z',
      formId: '5001',
      adName: 'Ad',
      campaignName: 'Camp',
      platform: 'ig',
      isOrganic: false,
      fieldData: [
        { name: 'full_name', values: ['Asha Rao'] },
        { name: 'multi', values: ['a', 'b'] },
        { name: 'empty', values: [] },
      ],
      disclaimerResponses: [
        { key: 'cb1', checked: true },
        { key: 'cb2', checked: false },
      ],
    });
    expect(l?.raw).toBeDefined();
  });

  it('needs an id', () => {
    expect(normaliseLead({ field_data: [] })).toBeNull();
    expect(normaliseLead(undefined)).toBeNull();
  });
});

describe('the Page’s webhook subscription', () => {
  const answer = {
    data: [
      { id: '111', subscribed_fields: ['feed', 'messages'] },
      { id: '222', subscribed_fields: ['leadgen'] },
    ],
  };
  it('reads this app’s entry', () => {
    expect(subscribedFieldsOf(answer, '222')).toEqual(['leadgen']);
    expect(subscribedFieldsOf(answer, '999')).toEqual([]);
  });
  it('takes the only entry when the app id is unknown, and nothing when there are several', () => {
    expect(subscribedFieldsOf({ data: [{ id: '1', subscribed_fields: ['feed'] }] }, null)).toEqual([
      'feed',
    ]);
    expect(subscribedFieldsOf(answer, null)).toEqual([]);
    expect(subscribedFieldsOf({}, '1')).toEqual([]);
  });
  it('adds and removes fields without repeating or dropping the rest', () => {
    expect(mergeSubscribedFields(['feed', 'messages'], ['messages', 'leadgen'])).toEqual([
      'feed',
      'messages',
      'leadgen',
    ]);
    expect(mergeSubscribedFields(['feed', 'leadgen'], [], ['leadgen'])).toEqual(['feed']);
    expect(mergeSubscribedFields([], [], ['leadgen'])).toEqual([]);
  });
});
