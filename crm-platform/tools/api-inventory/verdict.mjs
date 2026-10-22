// Why a route has no latency figure: said plainly, never counted as fast.
export function verdict(t, isGet) {
  if (!isGet)
    return { kind: 'write', why: 'write: needs a valid body per route and changes data, not run' };
  if (!t) return { kind: 'none', why: 'not called' };
  if (t.status >= 200 && t.status < 400 && t.p95 != null) return { kind: 'timed', why: '' };
  if (t.status === 401)
    return { kind: 'auth', why: '401: needs another credential (API key or partner token)' };
  if (t.status === 403)
    return {
      kind: 'gated',
      why: '403: feature or plan not available to the test workspace, or a provider webhook check',
    };
  if (t.status === 404)
    return {
      kind: 'nodata',
      why: t.resolved
        ? '404: no such record'
        : '404: no sample record for its path parameter in the seeded data',
    };
  if (t.status === 422 || t.status === 400)
    return {
      kind: 'input',
      why: `${t.status}: needs query input or a provider setup that the test workspace lacks`,
    };
  if (t.status === 429) return { kind: 'throttled', why: '429: rate limited' };
  if (t.status >= 500) return { kind: 'error', why: `${t.status}: server error` };
  return { kind: 'none', why: t.err ?? `status ${t.status}` };
}
