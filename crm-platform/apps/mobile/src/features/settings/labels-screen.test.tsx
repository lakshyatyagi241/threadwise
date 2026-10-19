import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { billing, libraryOf, sessionManagesLabels, unused, vip } from '@/test/labels-fixtures';
import { renderApp } from '@/test/render';
import * as api from './labels-api';
import { LabelsScreen } from './labels-screen';

jest.mock('./labels-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const listCall = jest.mocked(api.fetchLabelList);
const deleteCall = jest.mocked(api.deleteLabel);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(sessionManagesLabels);
  listCall.mockResolvedValue(libraryOf([vip, billing, unused]));
});

describe('LabelsScreen', () => {
  it('lists the labels with their description and how many conversations carry each', async () => {
    await renderApp(<LabelsScreen />);
    expect(await screen.findByRole('button', { name: 'VIP' })).toBeTruthy();
    expect(screen.getByText('Customers with a premium plan')).toBeTruthy();
    expect(screen.getByText('4 conversations')).toBeTruthy();
    expect(screen.getByText('1 conversation')).toBeTruthy();
    expect(screen.getByText('0 conversations')).toBeTruthy();
  });

  it('opens a label to edit it, and adds a new one from the round button', async () => {
    await renderApp(<LabelsScreen />);
    await press('VIP');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/label-form',
      params: { labelId: vip.id },
    });
    await press('New label');
    expect(router.push).toHaveBeenLastCalledWith('/label-form');
  });

  it('says so when there are no labels yet', async () => {
    listCall.mockResolvedValue(libraryOf([]));
    await renderApp(<LabelsScreen />);
    expect(await screen.findByText('No labels yet')).toBeTruthy();
    expect(screen.getByText(/Make your first label with the round button/)).toBeTruthy();
  });

  it('does not list anything, and offers no add button, for a person who may not manage labels', async () => {
    jest.mocked(fetchSession).mockResolvedValue(session);
    await renderApp(<LabelsScreen />);
    expect(await screen.findByText('You do not have permission to manage labels.')).toBeTruthy();
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();
  });

  it('shows the failure with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<LabelsScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByRole('button', { name: 'VIP' })).toBeTruthy();
  });

  it('asks before deleting, says what it removes it from, then deletes', async () => {
    deleteCall.mockResolvedValue(undefined);
    await renderApp(<LabelsScreen />);
    await press('Delete VIP');
    expect(await screen.findByText('Delete this label?')).toBeTruthy();
    expect(
      screen.getByText(
        '"VIP" will be removed from every conversation and every contact that carries it. This cannot be undone.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(vip.id));
    expect(await screen.findByText('Label deleted.')).toBeTruthy();
  });

  it('keeps the label when the person cancels', async () => {
    await renderApp(<LabelsScreen />);
    await press('Delete VIP');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Cancel' })).at(-1)!);
    expect(deleteCall).not.toHaveBeenCalled();
  });

  it('treats a label someone else already deleted as deleted, and shows other failures', async () => {
    deleteCall.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'x'));
    await renderApp(<LabelsScreen />);
    await press('Delete VIP');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    expect(await screen.findByText('Label deleted.')).toBeTruthy();
    deleteCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await press('Delete Billing');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<LabelsScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});
