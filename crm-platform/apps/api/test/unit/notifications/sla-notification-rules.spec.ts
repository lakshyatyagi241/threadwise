import { describe, expect, it } from 'vitest';
import { slaAudience, slaCopy } from '../../../src/modules/notifications/sla-notification.consumer';
import { pushText } from '../../../src/modules/notifications/push-payload';

describe('slaAudience', () => {
  it('tells the assignee and nobody else when there is one', () => {
    expect(slaAudience({ assigneeUserId: 7, teamMemberIds: [1, 2], managerIds: [9] })).toEqual([7]);
  });
  it('falls back to the team, then to the people who manage SLA policies', () => {
    expect(slaAudience({ assigneeUserId: null, teamMemberIds: [1, 2], managerIds: [9] })).toEqual([
      1, 2,
    ]);
    expect(slaAudience({ assigneeUserId: null, teamMemberIds: [], managerIds: [9] })).toEqual([9]);
    expect(slaAudience({ assigneeUserId: null, teamMemberIds: [], managerIds: [] })).toEqual([]);
  });
});

describe('slaCopy and the push', () => {
  it('names the clock that ran out', () => {
    expect(slaCopy('resolution').title).toContain('not resolved');
    expect(slaCopy('first_response').title).toContain('no first reply');
    expect(slaCopy('anything else').title).toContain('no first reply');
  });

  it('the OS notification carries the title only, never the customer name in the body', () => {
    const copy = slaCopy('first_response');
    const text = pushText({
      type: 'sla_breached',
      title: copy.title,
      body: `Asha Verma: ${copy.body}`,
      data: { conversationId: 'c', kind: 'first_response' },
      eventCount: 1,
    });
    expect(text.title).toBe(copy.title);
    expect(text.body).toBe('');
  });
});
