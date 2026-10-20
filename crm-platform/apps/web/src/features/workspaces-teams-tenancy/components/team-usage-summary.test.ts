import { describe, expect, it } from 'vitest';
import { usageLines } from './team-usage-summary';

describe('usageLines (the delete-team "what will change" list)', () => {
  it('leaves out what is zero and keeps the order a person weighs it in', () => {
    expect(
      usageLines({
        members: 3,
        routingRules: 0,
        assignmentRules: 2,
        segmentShares: 0,
        conversationsAssigned: 14,
        peopleWithReachChange: 3,
      }),
    ).toEqual([
      { key: 'members', count: 3 },
      { key: 'assignmentRules', count: 2 },
      { key: 'conversationsAssigned', count: 14 },
      { key: 'peopleWithReachChange', count: 3 },
    ]);
  });

  it('is empty for a team nothing refers to', () => {
    expect(
      usageLines({
        members: 0,
        routingRules: 0,
        assignmentRules: 0,
        segmentShares: 0,
        conversationsAssigned: 0,
        peopleWithReachChange: 0,
      }),
    ).toEqual([]);
  });
});
