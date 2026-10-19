import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import {
  assignees,
  fallback,
  pricing,
  rulesOf,
  sessionManagesRouting,
  sessionReadsRouting,
  spamRule,
} from '@/test/routing-fixtures';
import { renderApp } from '@/test/render';
import { AutoAssignmentScreen } from './auto-assignment-screen';
import * as api from './routing-api';

jest.mock('./routing-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const listCall = jest.mocked(api.fetchRules);
const settingsCall = jest.mocked(api.fetchRoutingSettings);
const saveSettingsCall = jest.mocked(api.saveRoutingSettings);
const namesCall = jest.mocked(api.fetchAssigneeNames);
const updateCall = jest.mocked(api.updateRule);
const getCall = jest.mocked(api.fetchRule);
const reorderCall = jest.mocked(api.reorderRules);
const duplicateCall = jest.mocked(api.duplicateRule);
const deleteCall = jest.mocked(api.deleteRule);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));
/** Presses the switch with this name (it reads its own state, so the tests say which way it should go). */
const flip = async (label: string, value: boolean) => {
  const toggle = await screen.findByRole('switch', { name: label });
  expect(toggle.props.accessibilityState.checked).toBe(!value);
  await fireEvent.press(toggle);
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(sessionManagesRouting);
  listCall.mockResolvedValue(rulesOf([pricing, fallback, spamRule]));
  settingsCall.mockResolvedValue({ keepContactAgent: false });
  namesCall.mockResolvedValue(assignees);
});

describe('AutoAssignmentScreen: the list', () => {
  it('shows each rule with its state, when it applies, who it assigns to and how often it fired', async () => {
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText('Pricing questions')).toBeTruthy();
    expect(screen.getByText('Send pricing chats to sales')).toBeTruthy();
    expect(screen.getByText('Channel: WhatsApp Cloud API')).toBeTruthy();
    expect(screen.getByText('Message has any of: price, cost')).toBeTruthy();
    expect(screen.getByText('Inside business hours')).toBeTruthy();
    expect(screen.getByText('Round robin: Asha Verma, meera@example.test')).toBeTruthy();
    expect(screen.getByText('1 agent unavailable')).toBeTruthy();
    expect(screen.getByText(/^Used 12 times · last on /)).toBeTruthy();
    expect(
      screen.getByText(/If nobody replies within 30 minutes:.*reassign it to this rule's agents/),
    ).toBeTruthy();
    expect(screen.getByText('Sends the reply: Thanks, we will reply soon.')).toBeTruthy();
    expect(screen.getByText('Adds the tags Sales')).toBeTruthy();
  });

  it('marks the fallback, a rule that keeps checking, and a flow that is switched off', async () => {
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText('Fallback')).toBeTruthy();
    expect(screen.getByText('Every conversation nobody matched')).toBeTruthy();
    expect(screen.getByText('Least busy: Sales')).toBeTruthy();
    expect(screen.getByText('Keeps checking')).toBeTruthy();
    expect(screen.getByText('Message has all of: win, prize')).toBeTruthy();
    expect(screen.getByText('Marks the conversation as spam')).toBeTruthy();
    expect(screen.getByText('Also starts the flow Welcome (Flow is switched off)')).toBeTruthy();
    expect(screen.getByText('Not used yet')).toBeTruthy();
  });

  it('says "an agent" for each agent nobody can name when the person may not read the inbox', async () => {
    jest.mocked(fetchSession).mockResolvedValue({
      ...sessionManagesRouting,
      permissions: { 'inbox.settings.read': 'all', 'inbox.routing.manage': 'all' },
    });
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText('Round robin: an agent, an agent')).toBeTruthy();
    expect(namesCall).not.toHaveBeenCalled();
  });

  it('searches by name, after a pause, and offers no moving while searching', async () => {
    await renderApp(<AutoAssignmentScreen />);
    await screen.findByText('Pricing questions');
    expect(screen.getAllByRole('button', { name: /^Move Pricing questions down$/ })).toHaveLength(
      1,
    );
    await fireEvent.changeText(screen.getByLabelText('Search rules by name'), ' price ');
    await waitFor(() =>
      expect(listCall).toHaveBeenLastCalledWith('price', undefined, expect.anything()),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Move / })).toBeNull());
  });

  it('says so when nothing matches the search, and when there are no rules yet', async () => {
    listCall.mockResolvedValue(rulesOf([]));
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText('No rules yet')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search rules by name'), 'zzz');
    expect(await screen.findByText('No rule found')).toBeTruthy();
    expect(screen.getByText('No rule is named like "zzz".')).toBeTruthy();
  });

  it("shows how many of the plan's rules are used, and says when all are", async () => {
    listCall.mockResolvedValue(rulesOf([pricing], { total: 3, limit: 5 }));
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText('3 of 5 rules used')).toBeTruthy();
  });

  it('says all the rules are used at the limit', async () => {
    listCall.mockResolvedValue(rulesOf([pricing], { total: 5, limit: 5 }));
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText('You have used all 5 rules your plan allows.')).toBeTruthy();
  });

  it('opens the business hours', async () => {
    await renderApp(<AutoAssignmentScreen />);
    await press('Business hours');
    expect(router.push).toHaveBeenCalledWith('/business-hours');
  });
});

describe('AutoAssignmentScreen: the setting', () => {
  it('shows the setting as saved, and saves a change', async () => {
    saveSettingsCall.mockResolvedValue({ keepContactAgent: true });
    await renderApp(<AutoAssignmentScreen />);
    expect(
      (await screen.findByRole('switch', { name: 'Keep returning contacts with their agent' }))
        .props.accessibilityState.checked,
    ).toBe(false);
    await flip('Keep returning contacts with their agent', true);
    await waitFor(() => expect(saveSettingsCall).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Keep returning contacts with their agent' }).props
          .accessibilityState.checked,
      ).toBe(true),
    );
  });

  it('says the setting could not be saved', async () => {
    saveSettingsCall.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'x'));
    await renderApp(<AutoAssignmentScreen />);
    await flip('Keep returning contacts with their agent', true);
    expect(await screen.findByText('Could not save the setting.')).toBeTruthy();
  });
});

describe('AutoAssignmentScreen: changing a rule', () => {
  it('switches a rule off with the version that was read', async () => {
    updateCall.mockResolvedValue({ ...pricing, isActive: false });
    await renderApp(<AutoAssignmentScreen />);
    await flip('Rule "Pricing questions" is active', false);
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(pricing.id, { rowVersion: 3, isActive: false }),
    );
  });

  it('reads the rule again and tries once more when someone else changed it first', async () => {
    updateCall
      .mockRejectedValueOnce(new ApiError(409, 'ROW_VERSION_CONFLICT', 'x'))
      .mockResolvedValue({ ...pricing, isActive: false });
    getCall.mockResolvedValue({ ...pricing, rowVersion: 4 });
    await renderApp(<AutoAssignmentScreen />);
    await flip('Rule "Pricing questions" is active', false);
    await waitFor(() => expect(updateCall).toHaveBeenCalledTimes(2));
    expect(updateCall).toHaveBeenLastCalledWith(pricing.id, { rowVersion: 4, isActive: false });
  });

  it('says the rule could not be switched', async () => {
    updateCall.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'x'));
    await renderApp(<AutoAssignmentScreen />);
    await flip('Rule "Pricing questions" is active', false);
    expect(await screen.findByText('Could not switch the rule.')).toBeTruthy();
  });

  it('moves a rule down and another up by putting the two ids in their new order', async () => {
    reorderCall.mockResolvedValue(undefined);
    await renderApp(<AutoAssignmentScreen />);
    await press('Move Pricing questions down');
    await waitFor(() => expect(reorderCall).toHaveBeenLastCalledWith([fallback.id, pricing.id]));
    await press('Move Everyone else up');
    await waitFor(() => expect(reorderCall).toHaveBeenLastCalledWith([fallback.id, pricing.id]));
  });

  it('does not offer to move the first rule up or the last one down', async () => {
    await renderApp(<AutoAssignmentScreen />);
    await screen.findByText('Pricing questions');
    expect(
      screen.getByRole('button', { name: 'Move Pricing questions up' }).props.accessibilityState
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Move Obvious spam down' }).props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  it('says the order could not be changed', async () => {
    reorderCall.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'x'));
    await renderApp(<AutoAssignmentScreen />);
    await press('Move Pricing questions down');
    expect(await screen.findByText('Could not change the order.')).toBeTruthy();
  });

  it('copies a rule and says the copy is switched off', async () => {
    duplicateCall.mockResolvedValue(fallback);
    await renderApp(<AutoAssignmentScreen />);
    await press('Duplicate Pricing questions');
    await waitFor(() => expect(duplicateCall).toHaveBeenCalledWith(pricing.id));
    expect(await screen.findByText('Rule copied. The copy is switched off.')).toBeTruthy();
  });

  it('asks before deleting, then deletes', async () => {
    deleteCall.mockResolvedValue(undefined);
    await renderApp(<AutoAssignmentScreen />);
    await press('Delete Pricing questions');
    expect(await screen.findByText('Delete this rule?')).toBeTruthy();
    expect(
      screen.getByText(
        '"Pricing questions" will stop assigning conversations. Conversations it already assigned stay as they are.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(pricing.id));
    expect(await screen.findByText('Rule deleted.')).toBeTruthy();
  });

  it('keeps the rule when the person cancels, and shows a failed delete', async () => {
    deleteCall.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'x'));
    await renderApp(<AutoAssignmentScreen />);
    await press('Delete Pricing questions');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Cancel' })).at(-1)!);
    expect(deleteCall).not.toHaveBeenCalled();
    await press('Delete Pricing questions');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    expect(await screen.findByText('Could not delete the rule.')).toBeTruthy();
  });
});

describe('AutoAssignmentScreen: who may do what', () => {
  it('shows the rules but nothing that changes them to a person who may only read', async () => {
    jest.mocked(fetchSession).mockResolvedValue(sessionReadsRouting);
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText('Pricing questions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(
      screen.getByRole('switch', { name: 'Rule "Pricing questions" is active' }).props
        .accessibilityState.disabled,
    ).toBe(true);
    expect(
      screen.getByRole('switch', { name: 'Keep returning contacts with their agent' }).props
        .accessibilityState.disabled,
    ).toBe(true);
  });

  it('shows nothing, and asks for nothing, for a person who may not read the settings', async () => {
    jest.mocked(fetchSession).mockResolvedValue(session);
    await renderApp(<AutoAssignmentScreen />);
    expect(
      await screen.findByText('You do not have permission to view the auto-assignment settings.'),
    ).toBeTruthy();
    expect(listCall).not.toHaveBeenCalled();
  });

  it('explains a plan without auto-assignment instead of showing rules', async () => {
    listCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'x'));
    settingsCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'x'));
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText('Auto-assignment is not included in your plan.')).toBeTruthy();
    expect(screen.queryByText('Pricing questions')).toBeNull();
  });

  it('shows another failure with a way to try again', async () => {
    listCall
      .mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'))
      .mockResolvedValue(rulesOf([pricing]));
    await renderApp(<AutoAssignmentScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByText('Pricing questions')).toBeTruthy();
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<AutoAssignmentScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});
