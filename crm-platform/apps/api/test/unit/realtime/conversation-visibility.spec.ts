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
  channelOwnerUserId: number | null = null,
): ConversationRecord => ({
  assigneeUserId,
  assigneeTeamId,
  channelOwnerUserId,
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

  describe('a personal mailbox (TW-MAIL-035)', () => {
    const asAdmin = (
      scope: ConversationViewer['scope'],
      teamIds: number[] = [],
    ): ConversationViewer => ({
      ...viewer(scope, teamIds),
      readsPersonalMail: true,
    });

    it('is visible to its owner whatever their assignment scope, even unassigned or assigned to a colleague', () => {
      for (const scope of ['all', 'team', 'own'] as const) {
        expect(conversationVisible(viewer(scope), record(null, null, ME))).toBe(true);
        expect(conversationVisible(viewer(scope), record(OTHER, OTHER_TEAM, ME))).toBe(true);
      }
    });
    it('is invisible to a colleague, even one who sees everything and even when it is assigned to them', () => {
      for (const scope of ['all', 'team', 'own'] as const) {
        expect(conversationVisible(viewer(scope, [MY_TEAM]), record(null, null, OTHER))).toBe(
          false,
        );
        expect(conversationVisible(viewer(scope, [MY_TEAM]), record(ME, MY_TEAM, OTHER))).toBe(
          false,
        );
      }
    });
    it('an admin reads it only when the policy lets admins (readsPersonalMail), and then by their scope as usual', () => {
      expect(conversationVisible(viewer('all'), record(null, null, OTHER))).toBe(false);
      expect(conversationVisible(asAdmin('all'), record(null, null, OTHER))).toBe(true);
      expect(conversationVisible(asAdmin('own'), record(null, null, OTHER))).toBe(false);
      expect(conversationVisible(asAdmin('own'), record(ME, null, OTHER))).toBe(true);
    });
    it('the owner without any read grant sees nothing, a mailbox is not a grant', () => {
      expect(conversationVisible(viewer(null), record(null, null, ME))).toBe(false);
    });
    it("an email channel whose mailbox row is gone (owner -1) is nobody's: only the admin reading right opens it", () => {
      expect(conversationVisible(viewer('all'), record(null, null, -1))).toBe(false);
      expect(conversationVisible(asAdmin('all'), record(null, null, -1))).toBe(true);
    });
    it('a shared channel (no owner) is unchanged by the admin flag', () => {
      expect(conversationVisible(asAdmin('team', [MY_TEAM]), record(OTHER, OTHER_TEAM))).toBe(
        false,
      );
      expect(conversationVisible(viewer('team', [MY_TEAM]), record(null))).toBe(true);
    });
  });
});
