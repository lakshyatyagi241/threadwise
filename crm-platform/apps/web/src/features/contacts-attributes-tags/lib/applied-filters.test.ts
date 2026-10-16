import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '../api/contacts';
import { appliedFilterChips, clearAllPatch, type ChipNames } from './applied-filters';

const ME = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const names: ChipNames = {
  words: {
    segment: 'Segment',
    group: 'Group',
    tag: 'Tag',
    owner: 'Owner',
    stage: 'Stage',
    status: 'Status',
    consent: 'Consent',
    source: 'Source',
    conditions: 'Conditions',
    imported: 'Imported',
    noGroup: 'No group',
    unassigned: 'Unassigned',
    myContacts: 'My contacts',
    formerMember: 'Former member',
    subscribed: 'Subscribed',
    unsubscribed: 'Opted out',
    conditionsValue: (n) => `Conditions: ${n}`,
  },
  group: (id) => (id === 'g1' ? 'VIPs' : undefined),
  segment: (id) => (id === 's1' ? 'Hot leads' : undefined),
  tag: (id) => (id === 't1' ? 'customer' : undefined),
  owner: (id) => (id === RAVI ? 'Ravi' : undefined),
  stage: (v) => (v === 'new' ? 'New' : undefined),
  status: (v) => (v === 'active' ? 'Active' : undefined),
  conditionCount: () => 2,
  aiSummary: null,
  meId: ME,
};

describe('appliedFilterChips', () => {
  it('has no chip for a list with no filter, and none for the search text or the sort', () => {
    expect(appliedFilterChips(DEFAULT_FILTERS, names)).toEqual([]);
    expect(
      appliedFilterChips(
        { ...DEFAULT_FILTERS, q: 'ana', sort: 'name', order: 'asc', page: 3 },
        names,
      ),
    ).toEqual([]);
  });

  it('makes one chip per active filter, each with the patch that removes it', () => {
    const chips = appliedFilterChips(
      {
        ...DEFAULT_FILTERS,
        tag: 't1',
        lifecycleStage: 'new',
        status: 'active',
        consent: 'unsubscribed',
        source: ' api ',
        owner: `${ME},${RAVI},none`,
        segment: 's1',
        rules: '{"type":"group"}',
      },
      names,
    );
    expect(chips.map((c) => c.label)).toEqual([
      'Segment: Hot leads',
      'Tag: customer',
      'Owner: My contacts, Ravi, Unassigned',
      'Stage: New',
      'Status: Active',
      'Consent: Opted out',
      'Source: api',
      'Conditions: 2',
    ]);
    expect(chips.find((c) => c.kind === 'tag')!.clear).toEqual({ tag: '' });
    expect(chips.find((c) => c.kind === 'segment')!.clear).toEqual({
      group: '',
      imported: false,
      segment: '',
    });
  });

  it('names a group, the quick lists and a person who left', () => {
    expect(appliedFilterChips({ ...DEFAULT_FILTERS, group: 'g1' }, names)[0]!.label).toBe(
      'Group: VIPs',
    );
    expect(appliedFilterChips({ ...DEFAULT_FILTERS, group: 'no_group' }, names)[0]!.label).toBe(
      'No group',
    );
    expect(appliedFilterChips({ ...DEFAULT_FILTERS, imported: true }, names)[0]!.label).toBe(
      'Imported',
    );
    expect(
      appliedFilterChips(
        { ...DEFAULT_FILTERS, owner: '33333333-3333-4333-8333-333333333333' },
        names,
      )[0]!.label,
    ).toBe('Owner: Former member');
  });

  it('shows what the AI understood in place of the condition count', () => {
    const chips = appliedFilterChips(
      { ...DEFAULT_FILTERS, rules: '{}' },
      { ...names, aiSummary: 'Not active for 30 days' },
    );
    expect(chips[0]!.label).toBe('Not active for 30 days');
  });

  it('clears everything but the search with one patch', () => {
    const patch = clearAllPatch();
    expect(Object.keys(patch).sort()).toEqual(
      [
        'consent',
        'group',
        'imported',
        'lifecycleStage',
        'minor',
        'owner',
        'rules',
        'segment',
        'source',
        'status',
        'tag',
      ].sort(),
    );
    expect(patch).not.toHaveProperty('q');
  });
});
