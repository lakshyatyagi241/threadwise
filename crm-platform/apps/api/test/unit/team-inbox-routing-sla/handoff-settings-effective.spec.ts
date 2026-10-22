import { describe, expect, it } from 'vitest';
import { HandoffService } from '../../../src/modules/team-inbox-routing-sla/handoff.service';

// `shape` is private and needs no collaborators: the screen must show what is IN EFFECT after a downgrade, not what an old plan left stored.
const shape = (stored: unknown, available: unknown) =>
  (
    HandoffService.prototype as unknown as {
      shape: (s: unknown, a: unknown) => Record<string, unknown>;
    }
  ).shape.call({}, stored, available);

const stored = {
  autoAssign: true,
  claimSetsOwner: true,
  ownerMode: 'keep_in_sync',
  continuityDays: 7,
  promptOwnerOnReassign: true,
  notifyQueue: true,
};
const none = {
  autoAssign: false,
  ownerFirst: false,
  keepInSync: false,
  continuityWindow: false,
  promptOwnerOnReassign: false,
};

describe('handoff settings shape', () => {
  it('shows saved choices a downgraded plan no longer honours as off / independent / no window', () => {
    const s = shape(stored, none);
    expect(s).toMatchObject({
      autoAssign: false,
      ownerMode: 'independent',
      continuityDays: null,
      promptOwnerOnReassign: false,
      claimSetsOwner: true,
      notifyQueue: true,
    });
  });
  it('shows them as saved when the plan includes them', () => {
    const all = {
      autoAssign: true,
      ownerFirst: true,
      keepInSync: true,
      continuityWindow: true,
      promptOwnerOnReassign: true,
    };
    expect(shape(stored, all)).toMatchObject({
      autoAssign: true,
      ownerMode: 'keep_in_sync',
      continuityDays: 7,
      promptOwnerOnReassign: true,
    });
  });
});
