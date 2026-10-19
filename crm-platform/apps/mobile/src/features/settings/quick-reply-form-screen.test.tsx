import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { sessionManagesReplies, thanks } from '@/test/quick-replies-fixtures';
import { renderApp } from '@/test/render';
import * as api from './quick-replies-api';
import { QuickReplyFormScreen } from './quick-reply-form-screen';

jest.mock('./quick-replies-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const createCall = jest.mocked(api.createQuickReply);
const updateCall = jest.mocked(api.updateQuickReply);
const getCall = jest.mocked(api.fetchQuickReply);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const fill = async (label: string, value: string) =>
  await fireEvent.changeText(await screen.findByLabelText(label), value);
const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));
const save = async () => await press('Save');

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(sessionManagesReplies);
});

describe('QuickReplyFormScreen: a new reply', () => {
  it('checks the fields before calling the API', async () => {
    await renderApp(<QuickReplyFormScreen />);
    await save();
    expect(
      await screen.findByText('Enter a shortcut made of letters, numbers or underscores.'),
    ).toBeTruthy();
    expect(screen.getByText('Enter a title.')).toBeTruthy();
    expect(screen.getByText('Enter the text of the reply.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('shows the shortcut the way it is stored while it is typed', async () => {
    await renderApp(<QuickReplyFormScreen />);
    await fill('Shortcut', 'Thank You');
    expect(await screen.findByText('Agents type /thank_you')).toBeTruthy();
  });

  it('creates the reply with what was typed, then goes back', async () => {
    createCall.mockResolvedValue(thanks);
    await renderApp(<QuickReplyFormScreen />);
    await fill('Shortcut', 'Thank You');
    await fill('Title', 'Thanks');
    await fill('Text', 'Hello there');
    await fill('Category (optional)', 'Greetings');
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Email' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Only me' }));
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith({
        shortcut: 'thank_you',
        title: 'Thanks',
        body: 'Hello there',
        category: 'Greetings',
        language: null,
        channelKinds: ['email'],
        scope: 'mine',
      }),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('inserts a variable at the cursor and shows the preview with sample data', async () => {
    await renderApp(<QuickReplyFormScreen />);
    await fill('Text', 'Hi , welcome');
    await fireEvent(await screen.findByLabelText('Text'), 'selectionChange', {
      nativeEvent: { selection: { start: 3, end: 3 } },
    });
    await press("Contact's first name");
    expect((await screen.findByLabelText('Text')).props.value).toBe('Hi {{first_name}}, welcome');
    expect((await screen.findByTestId('quick-reply-preview')).props.children).toBe(
      'Hi Amira, welcome',
    );
  });

  it('lists a variable the preview cannot fill in as left as written', async () => {
    await renderApp(<QuickReplyFormScreen />);
    await fill('Text', 'Order {{order_no}}');
    expect(await screen.findByText(/Not filled in the preview: \{\{order_no\}\}/)).toBeTruthy();
  });

  it('puts the error under the shortcut when it is already taken', async () => {
    createCall.mockRejectedValue(new ApiError(409, 'SAVED_REPLY_SHORTCUT_TAKEN', 'x'));
    await renderApp(<QuickReplyFormScreen />);
    await fill('Shortcut', 'thanks');
    await fill('Title', 'Thanks');
    await fill('Text', 'Hello');
    await save();
    expect(
      await screen.findByText(
        '/thanks is already used by another reply. Choose a different shortcut.',
      ),
    ).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('says the plan limit was reached', async () => {
    createCall.mockRejectedValue(new ApiError(402, 'PLAN_LIMIT_REACHED', 'x'));
    await renderApp(<QuickReplyFormScreen />);
    await fill('Shortcut', 'thanks');
    await fill('Title', 'Thanks');
    await fill('Text', 'Hello');
    await save();
    expect(
      await screen.findByText("You have reached your plan's limit of saved replies."),
    ).toBeTruthy();
  });

  it('puts a field the server refused under that field, and shows the offline sentence for a network failure', async () => {
    createCall
      .mockRejectedValueOnce(
        new ApiError(422, 'VALIDATION_FAILED', 'x', undefined, [
          { path: 'language', message: 'bad' },
        ]),
      )
      .mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<QuickReplyFormScreen />);
    await fill('Shortcut', 'thanks');
    await fill('Title', 'Thanks');
    await fill('Text', 'Hello');
    await save();
    expect(await screen.findByText('Use a language code such as en or pt-BR.')).toBeTruthy();
    await save();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it('does not open for a person who may not manage saved replies', async () => {
    jest.mocked(fetchSession).mockResolvedValue(session);
    await renderApp(<QuickReplyFormScreen />);
    expect(
      await screen.findByText('You do not have permission to manage saved replies.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Shortcut')).toBeNull();
  });
});

describe('QuickReplyFormScreen: editing a reply', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ replyId: thanks.id });
    getCall.mockResolvedValue(thanks);
  });

  it('opens with the reply filled in, and the scope fixed', async () => {
    await renderApp(<QuickReplyFormScreen />);
    expect((await screen.findByLabelText('Shortcut')).props.value).toBe('thanks');
    expect(screen.getByLabelText('Title').props.value).toBe('Thanks for getting in touch');
    expect(
      screen.getByRole('checkbox', { name: 'WhatsApp Cloud API' }).props.accessibilityState.checked,
    ).toBe(true);
    expect(screen.getByText('Everyone in the workspace')).toBeTruthy();
    expect(screen.getByText(/cannot change between shared and personal/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Only me' })).toBeNull();
  });

  it('saves with the version that was read and does not send the scope', async () => {
    updateCall.mockResolvedValue(thanks);
    await renderApp(<QuickReplyFormScreen />);
    await fill('Title', 'Thanks a lot');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        thanks.id,
        expect.objectContaining({ rowVersion: 3, title: 'Thanks a lot', shortcut: 'thanks' }),
      ),
    );
    expect(updateCall.mock.calls[0]?.[1]).not.toHaveProperty('scope');
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('reloads the reply and asks for a review when someone else changed it first', async () => {
    updateCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'x'));
    await renderApp(<QuickReplyFormScreen />);
    await fill('Title', 'Mine');
    getCall.mockResolvedValue({ ...thanks, title: 'Theirs', rowVersion: 4 });
    await save();
    expect(await screen.findByText(/Someone else changed this reply first/)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Title').props.value).toBe('Theirs'));
  });

  it('says the reply was not found when it is gone', async () => {
    getCall.mockRejectedValue(new ApiError(404, 'SAVED_REPLY_NOT_FOUND', 'x'));
    await renderApp(<QuickReplyFormScreen />);
    expect(await screen.findByText(/could not be found/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers to try again when the reply could not be read', async () => {
    getCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x')).mockResolvedValue(thanks);
    await renderApp(<QuickReplyFormScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByLabelText('Shortcut')).toBeTruthy();
  });

  it('goes back to the list when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<QuickReplyFormScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/quick-replies');
  });
});
