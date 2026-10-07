import 'server-only';
import { publicFormSchema, type PublicForm } from '@crm/contracts';
import { apiBase } from '@/lib/auth/server';
import { FORM_KEY } from '../lib/public-paths';

export type PublicFormResult =
  { status: 'ok'; form: PublicForm } | { status: 'missing' } | { status: 'unavailable' };

/**
 * The published form a visitor asked for, read on the server so the page arrives drawn (no flash, nothing to index). The API answers
 * ONE 404 for an unknown key, an archived or paused form and a workspace without the app: it never says which, and neither does
 * this page. A reply this build does not understand is "unavailable" (a transient error page), not "missing".
 */
export async function fetchPublicForm(key: string): Promise<PublicFormResult> {
  if (!FORM_KEY.test(key)) return { status: 'missing' };
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/v2/public/forms/${encodeURIComponent(key)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return { status: 'unavailable' };
  }
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'unavailable' };
  const parsed = publicFormSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { status: 'ok', form: parsed.data } : { status: 'unavailable' };
}
