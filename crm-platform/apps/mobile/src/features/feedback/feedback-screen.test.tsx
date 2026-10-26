import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { sendFeedback } from './feedback-api';
import { FeedbackScreen } from './feedback-screen';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
}));
jest.mock('@/lib/session/api');
jest.mock('./feedback-api');
const sendCall = jest.mocked(sendFeedback);
const sessionCall = jest.mocked(fetchSession);

const ticket = {
  id: '3f2a6f1e-6d2c-4f7e-9b0a-0d1c2e3f4a5b',
  ticketNumber: 'TKT-ABC123',
  subject: 'Hello',
  excerpt: 'Hi',
  status: 'open' as const,
  createdAt: '2026-10-26T10:00:00.000Z',
  resolvedAt: null,
};

let client: { clear: () => void } | undefined;
async function show() {
  const view = await renderApp(<FeedbackScreen />);
  client = view.queryClient;
  await screen.findByRole('header', { name: 'Send feedback' });
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
}
const type = (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);

beforeAll(async () => {
  await initI18n('en');
});
// A finished send is kept by the query client for five minutes after the screen closes; clearing it once the screen is gone
// lets Jest exit.
afterEach(async () => {
  await cleanup();
  client?.clear();
});
beforeEach(() => {
  jest.resetAllMocks();
  mockCanGoBack = true;
  sessionCall.mockResolvedValue(session);
  sendCall.mockResolvedValue(ticket);
});

describe('FeedbackScreen', () => {
  it('asks for a subject and a message, and sends nothing until both are written', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByText('Enter a subject.')).toBeTruthy();
    expect(screen.getByText('Write your feedback.')).toBeTruthy();
    expect(sendCall).not.toHaveBeenCalled();
  });

  it('files the feedback as a support ticket under the person, once, and shows the ticket number', async () => {
    await show();
    await type('Subject', '  Dark mode  ');
    await type('Your feedback', 'Please add a dark mode to the inbox.');
    await fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByText(/Your feedback was sent as ticket TKT-ABC123/)).toBeTruthy();
    expect(sendCall).toHaveBeenCalledTimes(1);
    expect(sendCall).toHaveBeenCalledWith(
      {
        reason: 'other',
        name: session.user.displayName ?? session.user.fullName,
        email: session.user.email,
        subject: 'Dark mode',
        message: 'Please add a dark mode to the inbox.',
      },
      expect.any(String),
    );
    expect(screen.getByText(new RegExp(session.user.email))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(mockBack).toHaveBeenCalled();
  });

  it('keeps what was typed and says why when the send fails, then sends with the same key on a retry', async () => {
    sendCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await type('Subject', 'Hello');
    await type('Your feedback', 'A message');
    await fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    expect(screen.getByLabelText('Subject').props.value).toBe('Hello');
    await fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByText(/TKT-ABC123/)).toBeTruthy();
    const keys = sendCall.mock.calls.map((call) => call[1]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalled();
    mockCanGoBack = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockReplace).toHaveBeenCalledWith('/menu');
  });
});
