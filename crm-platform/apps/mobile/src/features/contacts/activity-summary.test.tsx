import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { fetchSession } from '@/lib/session/api';
import {
  meetingA,
  noteA,
  pageOf,
  sessionFull,
  sessionReadOnly,
} from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import { ActivitySummary } from './activity-summary';
import { listContactMeetings } from './meetings-api';
import { listContactNotes } from './notes-api';
import { listContactTasksForSummary } from './task-summary-api';

jest.mock('./notes-api');
jest.mock('./meetings-api');
jest.mock('./task-summary-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const notesCall = jest.mocked(listContactNotes);
const meetingsCall = jest.mocked(listContactMeetings);
const tasksCall = jest.mocked(listContactTasksForSummary);
const router = { push: jest.fn() };
const CONTACT_ID = 'contact-1';

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ActivitySummary contactId={CONTACT_ID} />);
  client = view.queryClient;
  return view;
}
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  sessionCall.mockResolvedValue(sessionFull);
  notesCall.mockResolvedValue(pageOf([noteA]));
  meetingsCall.mockResolvedValue(pageOf([meetingA]));
  tasksCall.mockResolvedValue(pageOf([]));
});
afterEach(async () => {
  if (client) await settled(client);
});

describe('ActivitySummary', () => {
  it('counts each list from its first page', async () => {
    await show();
    expect(await screen.findByRole('button', { name: 'Notes, 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Meetings, 1' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasks, 0' })).toBeTruthy());
  });

  it('says "N+" when a list has more than the page it read', async () => {
    notesCall.mockResolvedValue(pageOf([noteA], 'cursor-2'));
    await show();
    expect(await screen.findByRole('button', { name: 'Notes, 1+' })).toBeTruthy();
  });

  it('opens the notes, the tasks and the meetings of the contact', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Notes, 1' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact-notes',
      params: { contactId: CONTACT_ID },
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Tasks, 0' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/tasks',
      params: { contactId: CONTACT_ID },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Meetings, 1' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact-meetings',
      params: { contactId: CONTACT_ID },
    });
  });

  it('fades the tasks row and asks nothing for a person who may not read tasks', async () => {
    sessionCall.mockResolvedValue(sessionReadOnly);
    await show();
    const tasks = await screen.findByRole('button', { name: 'Tasks, –' });
    expect(tasks.props.accessibilityState.disabled).toBe(true);
    await settled(client!);
    expect(tasksCall).not.toHaveBeenCalled();
  });
});
