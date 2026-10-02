import { describe, expect, it } from 'vitest';
import {
  conversationVisible,
  type ConversationRecord,
  type ConversationViewer,
} from '../../../src/realtime/audience/conversation-visibility';

const ME = 7;
const OTHER = 8;
const MY_TEAM = 100;
const OTHER_TEAM = 200;

const viewer = (
  scope: ConversationViewer['scope'],
  teamIds: number[] = [],
): ConversationViewer => ({
  userId: ME,
  scope,
  teamIds,
});
const record = (
  assigneeUserId: number | null,
  assigneeTeamId: number | null = null,
): ConversationRecord => ({
  assigneeUserId,
  assigneeTeamId,
});

describe('conversationVisible: who may see a conversation (plan 3.7)', () => {
  describe('no grant, or a deny', () => {
    it('sees nothing, whatever the record says', () => {
      for (const rec of [record(ME), record(null), record(OTHER, MY_TEAM)]) {
        expect(conversationVisible(viewer(null, [MY_TEAM]), rec)).toBe(false);
      }
    });
  });

  describe('scope all', () => {
    it('sees every conversation: assigned to anyone, to a team, or to nobody', () => {
      for (const rec of [record(ME), record(OTHER), record(null), record(null, OTHER_TEAM)]) {
        expect(conversationVisible(viewer('all'), rec)).toBe(true);
      }
    });
  });

  describe('scope team', () => {
    it('sees what is assigned to them', () => {
      expect(conversationVisible(viewer('team', [MY_TEAM]), record(ME))).toBe(true);
    });
    it('sees what is assigned to one of their teams (with or without a person on it)', () => {
      expect(conversationVisible(viewer('team', [MY_TEAM]), record(null, MY_TEAM))).toBe(true);
      expect(conversationVisible(viewer('team', [MY_TEAM]), record(OTHER, MY_TEAM))).toBe(true);
    });
    it('sees an unassigned conversation (it is the queue everybody works)', () => {
      expect(conversationVisible(viewer('team', []), record(null, null))).toBe(true);
    });
    it("does not see a colleague's conversation outside their teams", () => {
      expect(conversationVisible(viewer('team', [MY_TEAM]), record(OTHER))).toBe(false);
      expect(conversationVisible(viewer('team', [MY_TEAM]), record(OTHER, OTHER_TEAM))).toBe(false);
    });
    it("does not see another team's unassigned-to-a-person conversation", () => {
      expect(conversationVisible(viewer('team', [MY_TEAM]), record(null, OTHER_TEAM))).toBe(false);
    });
    it('with no team at all, sees only their own and the unassigned', () => {
      expect(conversationVisible(viewer('team', []), record(null, MY_TEAM))).toBe(false);
      expect(conversationVisible(viewer('team', []), record(ME))).toBe(true);
    });
  });

  describe('scope own', () => {
    it('sees only what is assigned to them', () => {
      expect(conversationVisible(viewer('own', [MY_TEAM]), record(ME))).toBe(true);
    });
    it('does not see the unassigned, a team, or a colleague', () => {
      expect(conversationVisible(viewer('own', [MY_TEAM]), record(null))).toBe(false);
      expect(conversationVisible(viewer('own', [MY_TEAM]), record(null, MY_TEAM))).toBe(false);
      expect(conversationVisible(viewer('own', [MY_TEAM]), record(OTHER, MY_TEAM))).toBe(false);
    });
  });
});
