import { describe, expect, it } from 'vitest';
import { updateLeadSourceSchema } from '@crm/contracts';
import { source } from '../test-fixtures';
import { draftFromSource } from './draft';
import { buildRulesUpdate, rulesDirty, rulesProblems } from './form-rules';

const USER = '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11';
const base = () => draftFromSource(source({ kind: 'meta_lead_ads', rowVersion: 3 }));

describe('the assignment and deal request', () => {
  it('saves only the defaults and the row version it was read at', () => {
    const d = { ...base(), ownerMode: 'fixed' as const, ownerUserIds: [USER] };
    const body = buildRulesUpdate(d, 3);
    expect(Object.keys(body).sort()).toEqual(['defaults', 'rowVersion']);
    expect(body.rowVersion).toBe(3);
    expect(body.defaults?.owner).toEqual({ mode: 'fixed', userIds: [USER] });
    expect(updateLeadSourceSchema.safeParse(body).success).toBe(true);
  });

  it('does not touch the mapping, the name or the retention', () => {
    const body = buildRulesUpdate(base(), 3);
    expect(body).not.toHaveProperty('mapping');
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('rawRetentionDays');
  });
});

describe('change tracking', () => {
  it('is dirty only when a rule changed', () => {
    const a = base();
    expect(rulesDirty(a, base())).toBe(false);
    expect(rulesDirty({ ...a, name: 'Another name' }, base())).toBe(false);
    expect(rulesDirty({ ...a, dealEnabled: true }, base())).toBe(true);
    expect(rulesDirty({ ...a, notifyOwner: !a.notifyOwner }, base())).toBe(true);
    expect(rulesDirty({ ...a, tag: 'Meta' }, base())).toBe(true);
  });
});

describe('problems', () => {
  it('has none for the rules a source already has', () => {
    expect(rulesProblems(base())).toEqual({});
  });

  it('names a fixed owner without exactly one person, in the rules paths only', () => {
    const p = rulesProblems({ ...base(), ownerMode: 'fixed', ownerUserIds: [] });
    expect(Object.keys(p)).toEqual(['defaults.owner.userIds']);
    expect(p['defaults.owner.userIds']!.key).toBe('ownerFixed');
  });

  it('ignores a problem in a field this dialog does not edit', () => {
    expect(rulesProblems({ ...base(), name: '', retentionDays: '0' })).toEqual({});
  });

  it('flags a round robin with one person and an over-long deal title', () => {
    const p = rulesProblems({
      ...base(),
      ownerMode: 'round_robin',
      ownerUserIds: [USER],
      dealTitle: 'x'.repeat(300),
    });
    expect(p['defaults.owner.userIds']!.key).toBe('ownerRoundRobin');
    expect(p['defaults.deal.title']!.key).toBe('dealTitleLength');
  });
});
