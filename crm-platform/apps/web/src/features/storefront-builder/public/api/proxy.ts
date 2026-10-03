import 'server-only';
import { apiBase } from '@/lib/auth/server';
import { isSameOrigin } from '../lib/same-origin';

/**
 * Forwarding for the shop's route handlers (`/s/<slug>/checkout|coupon|review|abandon|more`). They validate nothing: the API owns
 * every rule. They pass the JSON body and the buyer's address (`x-forwarded-for`, so the API's rate limits see the buyer, not
 * this server) and relay status and body unchanged. Only same-origin callers are served.
 */
export const PUBLIC_ACTIONS = ['checkout', 'coupon', 'review', 'abandon'] as const;
export type PublicAction = (typeof PUBLIC_ACTIONS)[number];

const MAX_BODY = 256 * 1024;

const problem = (status: number, code: string, title: string): Response =>
  new Response(JSON.stringify({ type: 'about:blank', title, status, code }), {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' },
  });

function forwardHeaders(req: Request, withBody: boolean): Record<string, string> {
  const out: Record<string, string> = { Accept: 'application/json' };
  if (withBody) out['Content-Type'] = 'application/json';
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) out['X-Forwarded-For'] = ip;
  for (const name of ['idempotency-key', 'x-request-id']) {
    const v = req.headers.get(name);
    if (v) out[name] = v;
  }
  return out;
}

async function relay(upstream: Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await upstream;
  } catch {
    return problem(502, 'INTERNAL', 'The shop is not reachable right now');
  }
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function forwardPublicPost(
  req: Request,
  slug: string,
  action: PublicAction,
): Promise<Response> {
  if (!isSameOrigin(req.headers))
    return problem(403, 'FORBIDDEN', 'Cross-site requests are not accepted');
  const body = await req.text();
  if (body.length > MAX_BODY) return problem(413, 'VALIDATION_FAILED', 'Request too large');
  return relay(
    fetch(`${apiBase()}/v2/store-public/${encodeURIComponent(slug)}/${action}`, {
      method: 'POST',
      headers: forwardHeaders(req, true),
      body,
      cache: 'no-store',
    }),
  );
}

/** "Show more": the next page of the catalog as the home endpoint returns it. */
export async function forwardPublicHome(req: Request, slug: string): Promise<Response> {
  if (!isSameOrigin(req.headers))
    return problem(403, 'FORBIDDEN', 'Cross-site requests are not accepted');
  const raw = Number.parseInt(new URL(req.url).searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(raw) && raw >= 1 ? raw : 1;
  return relay(
    fetch(`${apiBase()}/v2/store-public/${encodeURIComponent(slug)}/home?page=${page}&partial=1`, {
      method: 'GET',
      headers: forwardHeaders(req, false),
      cache: 'no-store',
    }),
  );
}

/**
 * Razorpay's webhook for shop payment links. The raw bytes and the signature header go through untouched (the signature is of
 * the exact body); the API is the only judge. Not same-origin checked: Razorpay posts from its own servers.
 */
export async function forwardPaymentWebhook(req: Request): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return problem(413, 'VALIDATION_FAILED', 'Request too large');
  const headers = forwardHeaders(req, true);
  const signature = req.headers.get('x-razorpay-signature');
  if (signature) headers['X-Razorpay-Signature'] = signature;
  return relay(
    fetch(`${apiBase()}/v2/store-public/webhooks/razorpay`, {
      method: 'POST',
      headers,
      body: raw,
      cache: 'no-store',
    }),
  );
}
