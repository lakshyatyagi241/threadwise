import { problem, proxyRequest } from '@/lib/auth/proxy';

/** Operator endpoints that return a token pair; the `/api/platform-auth/*` handlers own them. */
const TOKEN_ISSUING = new Set(['auth/login', 'auth/login/mfa', 'auth/refresh', 'auth/logout']);

/** Same-origin proxy for the platform-operator console: `/api/platform/*` -> `/v2/platform/*`. */
async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (TOKEN_ISSUING.has(path.join('/'))) return problem(404, 'NOT_FOUND', 'Not found');
  return proxyRequest(req, path, 'operator');
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
