import { describe, expect, it } from 'vitest';
import { createRoutingRuleSchema, updateRoutingRuleSchema } from '@crm/contracts';
import {
  decodeActions,
  encodeActions,
} from '../../../src/modules/team-inbox-routing-sla/routing-rules.mapper';

const U1 = '0b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b11';

describe('routing rule actions as stored', () => {
  it('a rule that only marks spam stores a mark_spam action and no assign', () => {
    const stored = encodeActions({
      assign: null,
      markSpam: true,
      priority: null,
      addTags: [],
      escalation: null,
      autoReply: null,
      triggerFlowId: null,
      description: '',
      cursor: null,
    });
    expect(stored).toEqual([{ type: 'mark_spam' }]);
    expect(decodeActions(stored)).toMatchObject({
      assign: null,
      markSpam: true,
      priority: null,
      addTags: [],
      triggerFlowId: null,
    });
  });

  it('assign, mark_spam, flow and note round-trip together, with the round robin cursor on the assign only', () => {
    const stored = encodeActions({
      assign: { strategy: 'round_robin', userIds: [U1], teamIds: [], everyone: false },
      markSpam: true,
      priority: null,
      addTags: [],
      escalation: null,
      autoReply: null,
      triggerFlowId: '1b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b12',
      description: 'scams',
      cursor: 7,
    });
    expect(decodeActions(stored)).toMatchObject({
      assign: { strategy: 'round_robin', userIds: [U1], teamIds: [] },
      markSpam: true,
      priority: null,
      addTags: [],
      triggerFlowId: '1b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b12',
      description: 'scams',
      cursor: 7,
    });
  });

  it('a row from before this change (an assign only) reads as it always did, with no spam mark', () => {
    const old = [
      { type: 'assign', strategy: 'specific', userIds: [U1], teamIds: [], rrCursor: null },
    ];
    expect(decodeActions(old)).toMatchObject({ assign: { strategy: 'specific' }, markSpam: false });
  });

  it('a create needs at least one action: an assign, a spam mark or a flow', () => {
    const base = { name: 'Rule', conditions: { keywords: { words: ['x'] } } };
    expect(createRoutingRuleSchema.safeParse(base).success).toBe(false);
    expect(createRoutingRuleSchema.safeParse({ ...base, markSpam: true }).success).toBe(true);
    expect(
      createRoutingRuleSchema.safeParse({
        ...base,
        assign: { strategy: 'specific', userIds: [U1] },
      }).success,
    ).toBe(true);
  });

  it('an update may drop the assign; the server checks the rule still does something', () => {
    expect(updateRoutingRuleSchema.safeParse({ rowVersion: 1, assign: null }).success).toBe(true);
    expect(updateRoutingRuleSchema.safeParse({ rowVersion: 1, markSpam: true }).success).toBe(true);
  });
});

describe('priority and tags as stored', () => {
  it('a priority and tags round-trip through the stored actions', () => {
    const stored = encodeActions({
      assign: null,
      markSpam: false,
      priority: 'high',
      addTags: [
        { name: 'VIP', color: null },
        { name: 'Refunds', color: '#FF0000' },
      ],
      escalation: null,
      autoReply: null,
      triggerFlowId: null,
      description: '',
      cursor: null,
    });
    expect(stored).toEqual([
      { type: 'set_priority', priority: 'high' },
      { type: 'add_tag', name: 'VIP', color: null },
      { type: 'add_tag', name: 'Refunds', color: '#FF0000' },
    ]);
    expect(decodeActions(stored)).toMatchObject({
      priority: 'high',
      addTags: [
        { name: 'VIP', color: null },
        { name: 'Refunds', color: '#FF0000' },
      ],
    });
  });

  it('a stored priority that is not a known value is ignored, and a tag without a name is dropped', () => {
    const decoded = decodeActions([
      { type: 'set_priority', priority: 'critical' },
      { type: 'add_tag', color: null },
      { type: 'add_tag', name: 'Keep', color: null },
    ]);
    expect(decoded).toMatchObject({ priority: null, addTags: [{ name: 'Keep' }] });
  });

  it('a rule that only sets a priority or adds a tag is a valid rule', () => {
    const base = { name: 'Rule', conditions: { keywords: { words: ['x'] } } };
    expect(createRoutingRuleSchema.safeParse({ ...base, priority: 'low' }).success).toBe(true);
    expect(
      createRoutingRuleSchema.safeParse({ ...base, addTags: [{ name: 'a', color: null }] }).success,
    ).toBe(true);
  });
});

describe('escalation as stored and validated', () => {
  it('the escalation round-trips through the stored actions', () => {
    const stored = encodeActions({
      assign: { strategy: 'specific', userIds: [U1], teamIds: [], everyone: false },
      markSpam: false,
      priority: null,
      addTags: [],
      escalation: { minutes: 15, reassign: true, priority: 'urgent' },
      autoReply: null,
      triggerFlowId: null,
      description: '',
      cursor: null,
    });
    expect(decodeActions(stored)).toMatchObject({
      escalation: { minutes: 15, reassign: true, priority: 'urgent' },
    });
  });

  it('an escalation that does nothing, or runs after too long, is refused', () => {
    const base = { name: 'Rule', conditions: { keywords: { words: ['x'] } } };
    expect(
      createRoutingRuleSchema.safeParse({
        ...base,
        escalation: { minutes: 5, reassign: false, priority: null },
      }).success,
    ).toBe(false);
    expect(
      createRoutingRuleSchema.safeParse({
        ...base,
        escalation: { minutes: 0, reassign: false, priority: 'high' },
      }).success,
    ).toBe(false);
    expect(
      createRoutingRuleSchema.safeParse({
        ...base,
        escalation: { minutes: 1441, reassign: false, priority: 'high' },
      }).success,
    ).toBe(false);
  });
});
