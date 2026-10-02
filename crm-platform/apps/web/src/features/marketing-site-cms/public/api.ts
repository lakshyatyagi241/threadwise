import 'server-only';
import type { z } from 'zod';
import { apiBase } from '@/lib/auth/server';

/** Reads a public CMS endpoint on the server. Returns null for 404 and for any failure, so a page can render "not found". */
export async function cmsPublic<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  query?: Record<string, string | undefined>,
): Promise<T | null> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) qs.set(k, v);
  const suffix = qs.toString();
  const url = `${apiBase()}/v2/public/cms${path}${suffix ? `?${suffix}` : ''}`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
