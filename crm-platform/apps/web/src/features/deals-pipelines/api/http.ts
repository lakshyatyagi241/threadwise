import { apiFetch, type ApiRequest } from '@/lib/api/client';

/**
 * Every deals call goes through here. Normally that is the real API. While the deals endpoints are not deployed, a
 * developer can switch the in-memory stand-in on (`NEXT_PUBLIC_DEALS_MOCK=1`, or `localStorage['deals:mock'] = '1'`
 * then reload) to work on the screens; it answers with the same shapes, parsed by the same schemas.
 */
export function mockEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DEALS_MOCK === '1') return true;
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('deals:mock') === '1';
  } catch {
    return false;
  }
}

export async function call<T>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  if (mockEnabled()) {
    const { mockCall } = await import('./mock-server');
    return mockCall(path, req);
  }
  return apiFetch(path, req);
}
