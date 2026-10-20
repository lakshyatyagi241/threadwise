import { describe, expect, it } from 'vitest';
import {
  PLAN_FEATURE_KEYS,
  RECORD_SCOPE_RANK,
  TEAM_HIERARCHY_FEATURE,
  isTeamScope,
  teamHierarchyGateExists,
  teamHierarchyOffered,
} from '@crm/contracts';
import { viewerReadsUnassigned } from '../../../src/realtime/audience/conversation-visibility';

/**
 * BL-382: the small rules around the new scope and the unassigned-queue permission.
 */
describe('scope order', () => {
  it('sorts own < team < team_and_below < all, so the widest allow wins and nobody grants wider than they hold', () => {
    expect(RECORD_SCOPE_RANK.own).toBeLessThan(RECORD_SCOPE_RANK.team);
    expect(RECORD_SCOPE_RANK.team).toBeLessThan(RECORD_SCOPE_RANK.team_and_below);
    expect(RECORD_SCOPE_RANK.team_and_below).toBeLessThan(RECORD_SCOPE_RANK.all);
  });
  it('names the two scopes that reach people through teams', () => {
    expect(isTeamScope('team')).toBe(true);
    expect(isTeamScope('team_and_below')).toBe(true);
    expect(isTeamScope('own')).toBe(false);
    expect(isTeamScope('all')).toBe(false);
    expect(isTeamScope(null)).toBe(false);
  });
});

describe('viewerReadsUnassigned: the read permission decides, acting rights keep their old rule', () => {
  it('for reading, it is exactly whether the person holds inbox.conversation.read_unassigned', () => {
    expect(viewerReadsUnassigned('inbox.conversation.read', 'team', true)).toBe(true);
    expect(viewerReadsUnassigned('inbox.conversation.read', 'team', false)).toBe(false);
    expect(viewerReadsUnassigned('inbox.conversation.read', 'team_and_below', false)).toBe(false);
  });
  it('for acting (reply, note, assign, resolve...) a team-scoped grant still covers the queue, an own-scoped one does not', () => {
    expect(viewerReadsUnassigned('inbox.conversation.reply', 'team', false)).toBe(true);
    expect(viewerReadsUnassigned('inbox.conversation.reply', 'team_and_below', false)).toBe(true);
    expect(viewerReadsUnassigned('inbox.conversation.reply', 'own', true)).toBe(false);
    expect(viewerReadsUnassigned('inbox.conversation.reply', null, true)).toBe(false);
  });
});

describe('teamHierarchyOffered (the gate for "My team and sub-teams")', () => {
  it('is open while the plan feature does not exist in the catalogue (teams T3 not merged yet)', () => {
    // On this branch the catalogue has no `team_hierarchy` key, so every workspace is offered the scope, whatever it has.
    expect(teamHierarchyOffered(false)).toBe(true);
    expect(teamHierarchyOffered(true)).toBe(true);
    expect(teamHierarchyOffered(null)).toBe(true);
  });
});

describe('teamHierarchyOffered once the plan feature exists', () => {
  const catalogue = [...PLAN_FEATURE_KEYS, TEAM_HIERARCHY_FEATURE];
  it('follows the workspace, and an unknown answer removes nothing', () => {
    expect(teamHierarchyGateExists(catalogue)).toBe(true);
    expect(teamHierarchyOffered(false, catalogue)).toBe(false);
    expect(teamHierarchyOffered(true, catalogue)).toBe(true);
    expect(teamHierarchyOffered(null, catalogue)).toBe(true);
  });
});
