import { describe, expect, it } from 'vitest';
import type { GraphLead } from '../../../src/infra/providers/meta-lead-ads/meta-lead-ads.port';
import {
  META_FIELD_KEYS,
  SWEEP_MAX_LOOKBACK_MS,
  SWEEP_OVERLAP_MS,
  classifyGraphError,
  cleanAnswer,
  clipError,
  consentOf,
  leadAccessOf,
  platformOf,
  sourceNameOf,
  sourceRefOf,
  suggestTarget,
  sweepSince,
  syncStateOf,
  toNormalisedLead,
} from '../../../src/modules/meta-lead-ads/meta-lead-rules';
import { planLeadGrant } from '../../../src/modules/leads/lead-consent';

const lead = (over: Partial<GraphLead> = {}): GraphLead => ({
  id: '9001',
  createdTime: '2026-10-16T08:30:00.000Z',
  formId: '5001',
  adId: 'ad-1',
  adName: 'Diwali offer',
  adsetId: 'as-1',
  adsetName: 'Mumbai 25-40',
  campaignId: 'c-1',
  campaignName: 'Diwali 2026',
  platform: 'facebook',
  isOrganic: false,
  fieldData: [
    { name: 'full_name', values: ['Asha Rao'] },
    { name: 'email', values: ['asha@example.test'] },
    { name: 'phone_number', values: ['p:+919876543210'] },
    { name: 'budget', values: ['10k', '20k'] },
  ],
  disclaimerResponses: [],
  raw: { id: '9001' },
  ...over,
});

const FORM = { formId: '5001', name: 'Diwali form', pageId: '100', checkboxes: [] };

describe('lead access (re-consent)', () => {
  it('is granted only when every lead permission is held, and names the missing ones', () => {
    expect(
      leadAccessOf([
        'pages_show_list',
        'leads_retrieval',
        'pages_manage_ads',
        'pages_read_engagement',
      ]),
    ).toEqual({ access: 'granted', missing: [] });
    const r = leadAccessOf(['pages_show_list', 'pages_read_engagement']);
    expect(r.access).toBe('missing');
    expect(r.missing).toEqual(['leads_retrieval', 'pages_manage_ads']);
    expect(leadAccessOf([]).access).toBe('missing');
  });
});

describe('what a Graph error means', () => {
  it('reads a revoked token, a withheld permission, a slow Meta and the rest', () => {
    for (const code of [190, 102, 463, 467]) expect(classifyGraphError(code)).toBe('token');
    for (const code of [10, 200, 299]) expect(classifyGraphError(code)).toBe('permission');
    for (const code of [1, 2, 4, 17, 32, 341, 613, 80000, 80014]) {
      expect(classifyGraphError(code)).toBe('transient');
    }
    expect(classifyGraphError(undefined)).toBe('transient');
    expect(classifyGraphError(100)).toBe('other');
    expect(classifyGraphError(803)).toBe('other');
  });

  it('keeps an error to 490 characters', () => {
    expect(clipError(null)).toBeNull();
    expect(clipError('')).toBeNull();
    expect(clipError('x'.repeat(600))).toHaveLength(490);
  });
});

describe('the sync state of a Page', () => {
  const base = {
    enabled: true,
    pageStatus: 'connected',
    access: 'granted' as const,
    lastError: null,
    lastErrorKind: null,
  };
  it('puts the first thing to do first', () => {
    expect(syncStateOf({ ...base, enabled: false })).toBe('off');
    expect(syncStateOf(base)).toBe('subscribed');
    expect(syncStateOf({ ...base, pageStatus: 'expired' })).toBe('needs_reconnect');
    expect(syncStateOf({ ...base, lastError: 'x', lastErrorKind: 'token' })).toBe(
      'needs_reconnect',
    );
    expect(syncStateOf({ ...base, access: 'missing' })).toBe('needs_lead_access');
    expect(syncStateOf({ ...base, lastError: 'x', lastErrorKind: 'permission' })).toBe(
      'needs_lead_access',
    );
    expect(syncStateOf({ ...base, lastError: 'boom', lastErrorKind: 'other' })).toBe('error');
    // A token problem outranks a missing permission: reconnecting is how the permission is asked for again.
    expect(syncStateOf({ ...base, pageStatus: 'expired', access: 'missing' })).toBe(
      'needs_reconnect',
    );
  });
});

describe('a form question', () => {
  it('maps itself by its type, else by Meta’s standard key, else it is the admin’s to map', () => {
    expect(suggestTarget('FULL_NAME', 'x')).toBe('name');
    expect(suggestTarget('first_name', 'x')).toBe('firstName');
    expect(suggestTarget('LAST_NAME', 'x')).toBe('lastName');
    expect(suggestTarget('EMAIL', 'x')).toBe('email');
    expect(suggestTarget('WORK_EMAIL', 'x')).toBe('email');
    expect(suggestTarget('PHONE', 'x')).toBe('phone');
    expect(suggestTarget('WORK_PHONE_NUMBER', 'x')).toBe('phone');
    expect(suggestTarget('CUSTOM', 'phone_number')).toBe('phone');
    expect(suggestTarget('CUSTOM', 'Full_Name')).toBe('name');
    expect(suggestTarget('CUSTOM', 'what_is_your_budget')).toBeNull();
    expect(suggestTarget('CITY', 'city')).toBeNull();
  });
});

describe('platform and answers', () => {
  it('says Instagram only when Meta says so, else Facebook', () => {
    expect(platformOf({ platform: 'instagram' })).toBe('Instagram');
    expect(platformOf({ platform: 'IG' })).toBe('Instagram');
    expect(platformOf({ platform: 'facebook' })).toBe('Facebook');
    expect(platformOf({ platform: null })).toBe('Facebook');
  });

  it('removes Meta’s p: marker from a phone and nothing else', () => {
    expect(cleanAnswer('p:+919876543210')).toBe('+919876543210');
    expect(cleanAnswer(' P: 98765 43210 ')).toBe('98765 43210');
    expect(cleanAnswer('p:ping me later')).toBe('p:ping me later');
    expect(cleanAnswer('  plain  ')).toBe('plain');
  });
});

describe('consent proof', () => {
  const boxes = [
    { key: 'cb1', text: 'I agree to be contacted on WhatsApp.', required: false },
    { key: 'cb2', text: 'I accept the terms.', required: true },
  ];

  it('is read only from a ticked box of the form’s own disclaimer, with its wording', () => {
    const c = consentOf(
      lead({
        disclaimerResponses: [
          { key: 'cb1', checked: true },
          { key: 'cb2', checked: false },
        ],
      }),
      boxes,
      '5001',
    );
    expect(c).toMatchObject({
      given: true,
      text: 'I agree to be contacted on WhatsApp.',
      formId: '5001',
      adId: 'ad-1',
      at: '2026-10-16T08:30:00.000Z',
    });
  });

  it('joins the wording of several ticked boxes', () => {
    const c = consentOf(
      lead({
        disclaimerResponses: [
          { key: 'cb1', checked: true },
          { key: 'cb2', checked: true },
        ],
      }),
      boxes,
      '5001',
    );
    expect(c?.text).toBe('I agree to be contacted on WhatsApp.\nI accept the terms.');
  });

  it('is nothing when no box is ticked, the box is unknown or the form has no disclaimer', () => {
    expect(consentOf(lead(), boxes, '5001')).toBeUndefined();
    expect(
      consentOf(lead({ disclaimerResponses: [{ key: 'cb1', checked: false }] }), boxes, '5001'),
    ).toBeUndefined();
    expect(
      consentOf(lead({ disclaimerResponses: [{ key: 'zzz', checked: true }] }), boxes, '5001'),
    ).toBeUndefined();
    expect(
      consentOf(lead({ disclaimerResponses: [{ key: 'cb1', checked: true }] }), [], '5001'),
    ).toBeUndefined();
  });

  it('is never read from an ordinary question that happens to sound like consent', () => {
    const l = lead({
      fieldData: [
        { name: 'phone_number', values: ['+919876543210'] },
        { name: 'i_agree_to_be_messaged', values: ['yes'] },
      ],
    });
    expect(toNormalisedLead(l, FORM).consent).toBeUndefined();
  });

  it('records a grant through the pipeline’s own policy when there is proof, and none when there is not', () => {
    const withProof = toNormalisedLead(
      lead({ disclaimerResponses: [{ key: 'cb1', checked: true }] }),
      { ...FORM, checkboxes: boxes },
    );
    const plan = planLeadGrant(withProof.consent, { phone: true, email: true });
    expect(plan?.proof.text).toBe('I agree to be contacted on WhatsApp.');
    expect(plan?.evidence).toMatchObject({ leadFormId: '5001', adId: 'ad-1' });
    expect(
      planLeadGrant(toNormalisedLead(lead(), FORM).consent, { phone: true, email: true }),
    ).toBeNull();
  });
});

describe('a Graph lead as the pipeline takes it', () => {
  it('files answers under the form’s keys, joins several answers and strips the phone marker', () => {
    const n = toNormalisedLead(lead(), FORM);
    expect(n.externalId).toBe('9001');
    expect(n.receivedAt).toBe('2026-10-16T08:30:00.000Z');
    expect(n.fields.full_name).toBe('Asha Rao');
    expect(n.fields.phone_number).toBe('+919876543210');
    expect(n.fields.budget).toBe('10k, 20k');
  });

  it('carries the campaign, ad set and ad NAMES as attribution, the form by name, and the ids as meta_* fields', () => {
    const n = toNormalisedLead(lead(), FORM);
    expect(n.attribution).toEqual({
      platform: 'Facebook',
      form: 'Diwali form',
      campaign: 'Diwali 2026',
      adset: 'Mumbai 25-40',
      ad: 'Diwali offer',
    });
    expect(n.fields[META_FIELD_KEYS.leadId]).toBe('9001');
    expect(n.fields[META_FIELD_KEYS.formId]).toBe('5001');
    expect(n.fields[META_FIELD_KEYS.adId]).toBe('ad-1');
    expect(n.fields[META_FIELD_KEYS.adsetId]).toBe('as-1');
    expect(n.fields[META_FIELD_KEYS.campaignId]).toBe('c-1');
    expect(n.fields[META_FIELD_KEYS.pageId]).toBe('100');
    expect(n.raw).toEqual({ id: '9001' });
  });

  it('leaves out what Meta did not send (an organic lead has no campaign) and skips unanswered questions', () => {
    const n = toNormalisedLead(
      lead({
        campaignName: null,
        adsetName: null,
        adName: null,
        adId: null,
        platform: 'instagram',
        createdTime: null,
        fieldData: [
          { name: 'email', values: ['a@example.test'] },
          { name: 'skipped', values: [] },
        ],
      }),
      FORM,
    );
    expect(n.attribution).toEqual({ platform: 'Instagram', form: 'Diwali form' });
    expect(n.receivedAt).toBeUndefined();
    expect('skipped' in n.fields).toBe(false);
    expect(META_FIELD_KEYS.adId in n.fields).toBe(false);
  });
});

describe('the source of a form', () => {
  it('has a stable reference and a name that fits', () => {
    expect(sourceRefOf('100', '5001')).toBe('meta_lead_form:100:5001');
    expect(sourceNameOf('My Shop', 'Diwali')).toBe('My Shop - Diwali');
    expect(sourceNameOf(null, 'Diwali')).toBe('Diwali');
    expect(sourceNameOf('P', 'x'.repeat(200))).toHaveLength(120);
  });
});

describe('the sweep window', () => {
  const now = new Date('2026-10-16T12:00:00.000Z');
  it('starts a little before the checkpoint', () => {
    const cp = new Date('2026-10-16T10:00:00.000Z');
    expect(sweepSince(cp, now)).toBe(Math.floor((cp.getTime() - SWEEP_OVERLAP_MS) / 1000));
  });
  it('never reaches further back than Meta keeps a lead', () => {
    const old = new Date('2026-01-01T00:00:00.000Z');
    expect(sweepSince(old, now)).toBe(Math.floor((now.getTime() - SWEEP_MAX_LOOKBACK_MS) / 1000));
  });
});
