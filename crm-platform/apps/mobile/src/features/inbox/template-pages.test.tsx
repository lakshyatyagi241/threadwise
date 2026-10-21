import type { InboxTemplateOption } from '@crm/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { CONVERSATION_ID, outgoing } from '@/test/inbox-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import {
  clearTemplateDraft,
  getTemplateDraft,
  setTemplateValue,
  startTemplateDraft,
} from './template-draft';
import { TemplatePickerScreen } from './template-picker-screen';
import { TemplatePreviewScreen } from './template-preview-screen';
import { TemplateVariablesScreen } from './template-variables-screen';

jest.mock('./api');
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: jest.fn(),
    useLocalSearchParams: jest.fn(),
    // The page is in front for the whole test.
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const templatesCall = jest.mocked(api.fetchInboxTemplates);
const sendCall = jest.mocked(api.sendTemplateMessage);
const back = jest.fn();
const navigate = jest.fn();
const replace = jest.fn();
const canGoBack = jest.fn();
const dismissTo = jest.fn();

const option = (over: Partial<InboxTemplateOption> = {}): InboxTemplateOption => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'order_update',
  language: 'en_US',
  category: 'UTILITY',
  header: null,
  body: 'Your order is on the way.',
  footer: null,
  buttons: [],
  slots: [],
  sendable: true,
  reason: null,
  ...over,
});
const withVariable = (over: Partial<InboxTemplateOption> = {}) =>
  option({
    name: 'welcome',
    header: 'Welcome',
    body: 'hi {{1}}, this is a test',
    footer: 'Reply STOP to opt out',
    buttons: ['visit website'],
    slots: [{ key: '1', label: 'first name', example: 'akshay' }],
    ...over,
  });
const offer = (data: InboxTemplateOption[], hasMore = false) =>
  templatesCall.mockResolvedValue({ data, hasMore });

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  clearTemplateDraft();
  canGoBack.mockReturnValue(true);
  jest
    .mocked(useRouter)
    .mockReturnValue({ back, navigate, replace, canGoBack, dismissTo } as unknown as ReturnType<
      typeof useRouter
    >);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: CONVERSATION_ID });
});

describe('Choose Template (page 1)', () => {
  it('lists the templates with their category, and goes back with the arrow', async () => {
    offer([
      option(),
      option({ id: '33333333-3333-4333-8333-333333333333', name: 'promo', category: 'MARKETING' }),
    ]);
    await renderApp(<TemplatePickerScreen />);
    expect(await screen.findByRole('button', { name: /^order_update/ })).toBeTruthy();
    expect(screen.getByText('utility')).toBeTruthy();
    expect(screen.getByText('marketing')).toBeTruthy();
    expect(screen.getByText('Choose Template')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalled();
  });

  it('opens Set variables for a template that can be sent, with the template in the draft', async () => {
    offer([withVariable()]);
    await renderApp(<TemplatePickerScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /^welcome/ }));
    expect(getTemplateDraft()).toMatchObject({ conversationId: CONVERSATION_ID, values: {} });
    expect(navigate).toHaveBeenCalledWith({
      pathname: '/template-variables',
      params: { id: CONVERSATION_ID },
    });
  });

  it('opens Set variables for a template with no variables too: nothing is sent from the list', async () => {
    offer([option()]);
    await renderApp(<TemplatePickerScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /^order_update/ }));
    expect(navigate).toHaveBeenCalledWith({
      pathname: '/template-variables',
      params: { id: CONVERSATION_ID },
    });
    expect(sendCall).not.toHaveBeenCalled();
  });

  it('reads the category and the reason out with a dimmed row, not as a hint', async () => {
    offer([
      option({
        name: 'otp',
        category: 'AUTHENTICATION',
        sendable: false,
        reason: 'authentication',
      }),
    ]);
    await renderApp(<TemplatePickerScreen />);
    expect(
      await screen.findByRole('button', {
        name: 'otp, authentication, One-time-password templates are sent by the system.',
      }),
    ).toBeTruthy();
  });

  it('says the conversation is not available, and asks for nothing, when the page has no conversation', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({});
    await renderApp(<TemplatePickerScreen />);
    expect(await screen.findByText('This conversation is no longer available.')).toBeTruthy();
    expect(templatesCall).not.toHaveBeenCalled();
  });

  it('greys out a template the app cannot send yet, with the reason, and does not open it', async () => {
    offer([option({ name: 'otp', sendable: false, reason: 'authentication' })]);
    await renderApp(<TemplatePickerScreen />);
    const row = await screen.findByRole('button', { name: /^otp/ });
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('One-time-password templates are sent by the system.')).toBeTruthy();
    await fireEvent.press(row);
    expect(navigate).not.toHaveBeenCalled();
    expect(getTemplateDraft()).toBeNull();
  });

  it('sends the search words to the API, and says when more templates exist', async () => {
    offer([option()], true);
    await renderApp(<TemplatePickerScreen />);
    await screen.findByRole('button', { name: /^order_update/ });
    expect(
      screen.getByText('There are more templates. Type in the search box to find them.'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search templates'), 'promo');
    await waitFor(() =>
      expect(templatesCall).toHaveBeenLastCalledWith(CONVERSATION_ID, 'promo', expect.anything()),
    );
  });

  it('says the number has no approved templates, or that none match a search', async () => {
    offer([]);
    await renderApp(<TemplatePickerScreen />);
    expect(await screen.findByText('No approved templates for this number yet.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search templates'), 'zzz');
    expect(await screen.findByText('No templates match your search.')).toBeTruthy();
  });

  it('says so when the list cannot be loaded, and loads it again on Try again', async () => {
    templatesCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    offer([option()]);
    await renderApp(<TemplatePickerScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^order_update/ })).toBeTruthy();
  });
});

describe('Set variables (page 2)', () => {
  const open = async (template = withVariable()) => {
    startTemplateDraft(CONVERSATION_ID, template);
    return renderApp(<TemplateVariablesScreen />);
  };

  it('shows the template as written, a box for each variable, and the buttons it has', async () => {
    await open();
    expect(await screen.findByText('Name: welcome')).toBeTruthy();
    expect(screen.getByText('Header:')).toBeTruthy();
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByText('hi {{1}}, this is a test')).toBeTruthy();
    expect(screen.getByText('Footer:')).toBeTruthy();
    expect(screen.getByText('Reply STOP to opt out')).toBeTruthy();
    expect(screen.getByLabelText('first name').props.placeholder).toBe('akshay');
    expect(screen.getByText('Buttons:')).toBeTruthy();
    expect(screen.getByText('visit website')).toBeTruthy();
  });

  it('keeps Send off until every variable has something in it', async () => {
    await open();
    const send = () => screen.getByRole('button', { name: 'Send' });
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText('first name'), '   ');
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText('first name'), 'Asha');
    expect(send().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('sends the values by their key, then clears the draft and returns to the conversation', async () => {
    sendCall.mockResolvedValue(outgoing(4, { body: 'hi Asha, this is a test' }));
    await open();
    await fireEvent.changeText(screen.getByLabelText('first name'), ' Asha ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(sendCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        expect.any(String),
        '22222222-2222-4222-8222-222222222222',
        { '1': 'Asha' },
      ),
    );
    await waitFor(() =>
      expect(dismissTo).toHaveBeenCalledWith({
        pathname: '/conversation/[id]',
        params: { id: CONVERSATION_ID },
      }),
    );
    expect(getTemplateDraft()).toBeNull();
    // The page ended the draft itself, so it must not also go back on its own.
    expect(back).not.toHaveBeenCalled();
  });

  it('can send a template with no variables, and says so', async () => {
    sendCall.mockResolvedValue(outgoing(4, {}));
    await open(option({ name: 'plain' }));
    expect(await screen.findByText('This template has no variables to fill in.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(sendCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        expect.any(String),
        expect.any(String),
        {},
      ),
    );
  });

  it('says why when the server refuses, and stays on the page with what was typed', async () => {
    sendCall.mockRejectedValue(new ApiError(422, 'CHANNEL_DISCONNECTED', 'not connected'));
    await open();
    await fireEvent.changeText(screen.getByLabelText('first name'), 'Asha');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText(
        'This channel is disconnected. Reconnect it on the web, then try again.',
      ),
    ).toBeTruthy();
    expect(dismissTo).not.toHaveBeenCalled();
    expect(screen.getByLabelText('first name').props.value).toBe('Asha');
    expect(getTemplateDraft()?.values).toEqual({ '1': 'Asha' });
  });

  it('repeats the same message for the same words, and makes a new one when the words change', async () => {
    sendCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await open();
    await fireEvent.changeText(screen.getByLabelText('first name'), 'Asha');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendCall).toHaveBeenCalledTimes(1));
    await screen.findByRole('alert');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendCall).toHaveBeenCalledTimes(2));
    expect(sendCall.mock.calls[1]?.[1]).toBe(sendCall.mock.calls[0]?.[1]);
    await fireEvent.changeText(screen.getByLabelText('first name'), 'Asha K');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendCall).toHaveBeenCalledTimes(3));
    expect(sendCall.mock.calls[2]?.[1]).not.toBe(sendCall.mock.calls[0]?.[1]);
  });

  it('opens the preview from Preview', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    expect(navigate).toHaveBeenCalledWith('/template-preview');
  });

  it('goes back once from the back arrow', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });

  it('opens the list again to an empty draft: what was typed is dropped when the person comes back to the list', async () => {
    startTemplateDraft(CONVERSATION_ID, withVariable());
    setTemplateValue('1', 'Asha');
    offer([withVariable()]);
    await renderApp(<TemplatePickerScreen />);
    expect(getTemplateDraft()).toBeNull();
  });

  it('goes back at once when there is no draft (the app was reloaded on this page)', async () => {
    await renderApp(<TemplateVariablesScreen />);
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });

  it('goes to the inbox when there is no draft and nothing to go back to', async () => {
    canGoBack.mockReturnValue(false);
    await renderApp(<TemplateVariablesScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/inbox'));
    expect(back).not.toHaveBeenCalled();
  });

  it('does not also go back when the draft is cleared while the page is being closed', async () => {
    await open();
    await act(async () => clearTemplateDraft());
    expect(back).not.toHaveBeenCalled();
  });

  it('says what a value must not hold, and keeps Send off until it is fixed', async () => {
    await open();
    await fireEvent.changeText(screen.getByLabelText('first name'), 'a    b');
    expect(screen.getByText('Use no new lines, tabs or more than 3 spaces in a row.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.changeText(screen.getByLabelText('first name'), 'a b');
    expect(screen.queryByText('Use no new lines, tabs or more than 3 spaces in a row.')).toBeNull();
  });

  it('tells a screen reader why Send is off, and stops telling it once every variable is filled', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityHint).toBe(
      'Fill in every variable to send.',
    );
    await fireEvent.changeText(screen.getByLabelText('first name'), 'Asha');
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityHint).toBeUndefined();
  });

  it('keeps the keyboard from learning or filling in what goes into a customer message', async () => {
    await open();
    const input = screen.getByLabelText('first name');
    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.autoComplete).toBe('off');
    expect(input.props.importantForAutofill).toBe('no');
  });

  it('makes one request for two quick presses on Send, and locks Preview and Back while it is on its way', async () => {
    let finish: ((m: ReturnType<typeof outgoing>) => void) | undefined;
    sendCall.mockImplementation(() => new Promise((resolve) => (finish = resolve as never)));
    await open();
    await fireEvent.changeText(screen.getByLabelText('first name'), 'Asha');
    const send = screen.getByRole('button', { name: 'Send' });
    await act(async () => {
      await fireEvent.press(send);
      await fireEvent.press(send);
    });
    expect(sendCall).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Preview' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(back).not.toHaveBeenCalled();
    await act(async () => finish?.(outgoing(4, {})));
    await waitFor(() => expect(dismissTo).toHaveBeenCalledTimes(1));
  });

  it('makes a new message after the server refuses, so an old refusal is never replayed', async () => {
    sendCall.mockRejectedValue(new ApiError(422, 'CHANNEL_DISCONNECTED', 'down'));
    await open();
    await fireEvent.changeText(screen.getByLabelText('first name'), 'Asha');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('alert');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendCall).toHaveBeenCalledTimes(2));
    expect(sendCall.mock.calls[1]?.[1]).not.toBe(sendCall.mock.calls[0]?.[1]);
  });
});

describe('Preview (page 3)', () => {
  it('draws the message as the customer will see it: header, filled body, footer and buttons', async () => {
    startTemplateDraft(CONVERSATION_ID, withVariable());
    setTemplateValue('1', 'Asha');
    await renderApp(<TemplatePreviewScreen />);
    expect(await screen.findByText('Preview (welcome)')).toBeTruthy();
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByText('hi Asha, this is a test')).toBeTruthy();
    expect(screen.getByText('Reply STOP to opt out')).toBeTruthy();
    expect(screen.getByText('visit website')).toBeTruthy();
    expect(sendCall).not.toHaveBeenCalled();
  });

  it('still shows {{1}} for a variable with nothing typed yet', async () => {
    startTemplateDraft(CONVERSATION_ID, withVariable());
    await renderApp(<TemplatePreviewScreen />);
    expect(await screen.findByText('hi {{1}}, this is a test')).toBeTruthy();
  });

  it('shows what is typed on the page before it, live', async () => {
    startTemplateDraft(CONVERSATION_ID, withVariable());
    await renderApp(<TemplatePreviewScreen />);
    await act(async () => setTemplateValue('1', 'Rohan'));
    expect(await screen.findByText('hi Rohan, this is a test')).toBeTruthy();
  });

  it('goes to the inbox when there is no draft and nothing to go back to', async () => {
    canGoBack.mockReturnValue(false);
    await renderApp(<TemplatePreviewScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/inbox'));
  });

  it('does not go back by itself when the draft is cleared while another page closes', async () => {
    startTemplateDraft(CONVERSATION_ID, withVariable());
    await renderApp(<TemplatePreviewScreen />);
    await act(async () => clearTemplateDraft());
    expect(back).not.toHaveBeenCalled();
  });

  it('goes back with the arrow, and by itself when there is no draft', async () => {
    startTemplateDraft(CONVERSATION_ID, withVariable());
    const view = await renderApp(<TemplatePreviewScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalledTimes(1);
    await view.unmount();
    clearTemplateDraft();
    back.mockClear();
    await renderApp(<TemplatePreviewScreen />);
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });
});
