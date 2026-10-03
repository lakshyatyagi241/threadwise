import 'server-only';
import { cookies } from 'next/headers';
import type { z } from 'zod';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';

/** Reads a signed-in `/v2/cms/*` endpoint on the server as the current user; null for a 404 or any failure. */
export async function userCms<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  query?: Record<string, string | undefined>,
): Promise<T | null> {
  const at = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!at) return null;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) qs.set(k, v);
  try {
    const res = await fetch(`${apiBase()}/v2/cms${path}${qs.size ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${at}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
