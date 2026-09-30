import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setSessionCookies, type TokenPair } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';

const bodySchema = z.object({
  orgSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400, headers: { 'content-type': 'application/problem+json' } },
    );
  }
  const upstream = await fetch(`${apiBase()}/v2/auth/staff/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': req.headers.get('x-request-id') ?? crypto.randomUUID(),
    },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });
  if (!upstream.ok) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/problem+json',
      },
    });
  }
  setSessionCookies(await cookies(), (await upstream.json()) as TokenPair);
  return NextResponse.json({ ok: true });
}
