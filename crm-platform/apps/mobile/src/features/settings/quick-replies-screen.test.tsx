import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import {
  listOf,
  lockedReply,
  myNote,
  sessionManagesReplies,
  thanks,
} from '@/test/quick-replies-fixtures';
import { renderApp } from '@/test/render';
import * as api from './quick-replies-api';
import { QuickRepliesScreen } from './quick-replies-screen';

jest.mock('./quick-replies-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const listCall = jest.mocked(api.fetchQuickReplies);
const deleteCall = jest.mocked(api.deleteQuickReply);
const duplicateCall = jest.mocked(api.duplicateQuickReply);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(sessionManagesReplies);
  listCall.mockResolvedValue(listOf([thanks, myNote, lockedReply]));
});

describe('QuickRepliesScreen', () => {
  it('lists the replies with their shortcut, who can use them and how much they were used', async () => {
    await renderApp(<QuickRepliesScreen />);
    expect(
      await screen.findByRole('button', { name: 'Thanks for getting in touch, /thanks' }),
    ).toBeTruthy();
    expect(screen.getByText('/thanks · Greetings')).toBeTruthy();
    expect(screen.getByText('Used 12 times')).toBeTruthy();
    expect(screen.getByText('Not used yet')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'All (3)' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Mine (1)' })).toBeTruthy();
  });

  it('asks for the shared or personal ones when a tab is chosen', async () => {
    await renderApp(<QuickRepliesScreen />);
    await screen.findByText('Refund policy');
    await fireEvent.press(screen.getByRole('radio', { name: /^Mine/ }));
    await waitFor(() =>
      expect(listCall).toHaveBeenLastCalledWith(
        { scope: 'mine', q: '' },
        undefined,
        expect.anything(),
      ),
    );
  });

  it('searches by what is typed, after a pause', async () => {
    await renderApp(<QuickRepliesScreen />);
    await screen.findByText('Refund policy');
    await press('Search saved replies');
    await fireEvent.changeText(await screen.findByLabelText('Search saved replies'), ' refund ');
    await waitFor(() =>
      expect(listCall).toHaveBeenLastCalledWith(
        { scope: 'all', q: 'refund' },
        undefined,
        expect.anything(),
      ),
    );
  });

  it('says so when nothing matches the search, and when there are no replies yet', async () => {
    listCall.mockResolvedValue(listOf([]));
    await renderApp(<QuickRepliesScreen />);
    expect(await screen.findByText('No saved replies yet')).toBeTruthy();
    await press('Search saved replies');
    await fireEvent.changeText(await screen.findByLabelText('Search saved replies'), 'zzz');
    expect(await screen.findByText('Nothing found')).toBeTruthy();
    expect(screen.getByText('No saved reply matches "zzz".')).toBeTruthy();
  });

  it('does not list anything for a person who may not manage saved replies', async () => {
    jest.mocked(fetchSession).mockResolvedValue(session);
    await renderApp(<QuickRepliesScreen />);
    expect(
      await screen.findByText('You do not have permission to manage saved replies.'),
    ).toBeTruthy();
    expect(listCall).not.toHaveBeenCalled();
  });

  it('shows the failure with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<QuickRepliesScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByText('Refund policy')).toBeTruthy();
  });

  it('adds a reply from the round button, and opens one to edit it', async () => {
    await renderApp(<QuickRepliesScreen />);
    await press('New saved reply');
    expect(router.push).toHaveBeenCalledWith('/quick-reply-form');
    await press('Thanks for getting in touch, /thanks');
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/quick-reply-form',
      params: { replyId: thanks.id },
    });
  });

  it('says why a shared reply cannot be changed instead of opening it', async () => {
    await renderApp(<QuickRepliesScreen />);
    await press('Refund policy, /refund_policy');
    expect(
      await screen.findByText(/Only people who manage saved replies can change a shared reply/),
    ).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  describe('the dots on a row', () => {
    const openMenu = async (title: string) => {
      await renderApp(<QuickRepliesScreen />);
      await press(`Actions for ${title}`);
    };

    it('offers Edit, Duplicate and Delete for a reply the person may change, and only Duplicate for another', async () => {
      await openMenu('Thanks for getting in touch');
      expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      await press('Actions for Refund policy');
      expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('opens the form from Edit', async () => {
      await openMenu('Thanks for getting in touch');
      await press('Edit');
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/quick-reply-form',
        params: { replyId: thanks.id },
      });
    });

    it('duplicates, and says so', async () => {
      duplicateCall.mockResolvedValue(myNote);
      await openMenu('Thanks for getting in touch');
      await press('Duplicate');
      await waitFor(() => expect(duplicateCall).toHaveBeenCalledWith(thanks.id));
      expect(await screen.findByText('Saved reply duplicated.')).toBeTruthy();
    });

    it('says the plan limit was reached when a copy cannot be made', async () => {
      duplicateCall.mockRejectedValue(new ApiError(402, 'PLAN_LIMIT_REACHED', 'x'));
      await openMenu('Thanks for getting in touch');
      await press('Duplicate');
      expect(await screen.findByText(/reached your plan's limit/)).toBeTruthy();
    });

    it('asks before deleting, names who loses it, then deletes', async () => {
      deleteCall.mockResolvedValue(undefined);
      await openMenu('Thanks for getting in touch');
      await press('Delete');
      expect(await screen.findByText('Delete this saved reply?')).toBeTruthy();
      expect(
        screen.getByText('/thanks will be removed for everyone in the workspace.'),
      ).toBeTruthy();
      await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
      await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(thanks.id));
      expect(await screen.findByText('Saved reply deleted.')).toBeTruthy();
    });

    it('says a personal reply is removed from the person’s own replies, and keeps it when cancelled', async () => {
      await openMenu('I will call you back');
      await press('Delete');
      expect(await screen.findByText('/call_back will be removed from your replies.')).toBeTruthy();
      await fireEvent.press(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);
      expect(deleteCall).not.toHaveBeenCalled();
    });

    it('treats a reply someone else already deleted as deleted', async () => {
      deleteCall.mockRejectedValue(new ApiError(404, 'SAVED_REPLY_NOT_FOUND', 'x'));
      await openMenu('Thanks for getting in touch');
      await press('Delete');
      await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
      expect(await screen.findByText('Saved reply deleted.')).toBeTruthy();
    });
  });

  describe('the plan limit', () => {
    it('shows how much is used, and warns when close', async () => {
      listCall.mockResolvedValue(listOf([thanks], { total: 8, limit: 10 }));
      await renderApp(<QuickRepliesScreen />);
      expect(await screen.findByText('8 of 10 saved replies used')).toBeTruthy();
      expect(screen.getByText(/close to your plan's limit of 10/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'New saved reply' })).toBeTruthy();
    });

    it('stops offering to add one at the limit', async () => {
      listCall.mockResolvedValue(listOf([thanks], { total: 10, limit: 10 }));
      await renderApp(<QuickRepliesScreen />);
      expect(await screen.findByText(/reached your plan's limit of 10/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'New saved reply' })).toBeNull();
    });

    it('shows no meter on a plan without a limit', async () => {
      await renderApp(<QuickRepliesScreen />);
      await screen.findByText('Refund policy');
      expect(screen.queryByText(/saved replies used/)).toBeNull();
    });
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<QuickRepliesScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});
