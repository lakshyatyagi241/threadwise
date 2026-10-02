import { apiFetch, type ApiRequest } from '@/lib/api/client';

/**
 * Every tasks call goes through here. Normally that is the real API. While the tasks endpoints are not deployed on a server,
 * a developer can switch the in-memory stand-in on (`NEXT_PUBLIC_TASKS_MOCK=1`, or `localStorage['tasks:mock'] = '1'` then
 * reload) to work on the screens; it answers with the same shapes, parsed by the same schemas.
 */
export function mockEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_TASKS_MOCK === '1') return true;
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('tasks:mock') === '1';
  } catch {
    return false;
  }
}

/** Who the stand-in treats as the signed-in person (set from the session, see `useTasksSetup`). */
export const mockState: { me: { id: string; name: string } } = { me: { id: 'me', name: 'You' } };
export function configureMock(me: { id: string; name: string }): void {
  mockState.me = me;
}

/** Names of the contacts and deals a person linked while the stand-in is on, so its tasks can show them. */
export const mockRefs = new Map<string, string>();
export const rememberMockRef = (kind: 'contact' | 'deal', id: string, label: string): void => {
  if (mockEnabled()) mockRefs.set(`${kind}:${id}`, label);
};

export async function call<T>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  if (mockEnabled()) {
    const { mockCall } = await import('./mock-server');
    return mockCall(path, req);
  }
  return apiFetch(path, req);
}

/** For the contact and deal pickers: those lists are real even while the tasks stand-in is on. */
export const callReal = apiFetch;
