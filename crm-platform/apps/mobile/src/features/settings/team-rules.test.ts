import { WSP_TEAM_NAME_MAX } from '@crm/contracts';
import { TEAM_COLORS } from '@/lib/theme/tokens';
import { sales, support } from '@/test/teams-fixtures';
import {
  draftOfTeam,
  emptyTeamDraft,
  nameProblem,
  onlineCount,
  sameColor,
  swatchesFor,
  toCreateInput,
  toUpdateInput,
  toggleId,
} from './team-rules';

describe('the team form rules', () => {
  it('starts blank on the default colour and manual assignment', () => {
    expect(emptyTeamDraft()).toEqual({
      name: '',
      color: '#075E54',
      assignmentStrategy: 'manual',
      memberIds: [],
    });
  });

  it('takes its start from the team', () => {
    expect(draftOfTeam(sales)).toEqual({
      name: 'Sales',
      color: '#13478A',
      assignmentStrategy: 'round_robin',
      memberIds: sales.members.map((m) => m.id),
    });
  });

  it('compares colours without the # and the case', () => {
    expect(sameColor('#075e54', '075E54')).toBe(true);
    expect(sameColor('#075E54', '#13478A')).toBe(false);
  });

  it("offers the six colours, plus the team's own when it is another one", () => {
    expect(swatchesFor('#075e54')).toEqual([...TEAM_COLORS]);
    expect(swatchesFor('teal')).toEqual([...TEAM_COLORS, 'teal']);
  });

  it('asks for a name, and not too long a one', () => {
    expect(nameProblem('  ')).toBe('required');
    expect(nameProblem('a'.repeat(WSP_TEAM_NAME_MAX + 1))).toBe('tooLong');
    expect(nameProblem(' Sales ')).toBeNull();
  });

  it('adds a person to a list and takes them out again', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('creates with a trimmed name and no devices', () => {
    expect(toCreateInput({ ...emptyTeamDraft(), name: ' Sales ', memberIds: ['x'] })).toEqual({
      name: 'Sales',
      color: '#075E54',
      assignmentStrategy: 'manual',
      memberIds: ['x'],
      deviceIds: [],
      receivesConversations: true,
      receivesRecords: true,
    });
  });

  it('saves with the version that was read and never touches the devices', () => {
    const input = toUpdateInput(draftOfTeam(support), support);
    expect(input).toEqual({
      name: 'Support',
      color: 'teal',
      assignmentStrategy: 'manual',
      memberIds: [],
      rowVersion: 1,
    });
    expect('deviceIds' in input).toBe(false);
  });

  it('counts who is online', () => {
    expect(onlineCount(sales)).toBe(1);
    expect(onlineCount(support)).toBe(0);
  });
});
