/**
 * The public address of the customer API, as shown to a customer (the Developers page base URL, the cURL examples, a template's request
 * sample). Never an internal address: in a container the proxy target `API_URL` is a service name such as `http://desk-api-blue:3000`,
 * which no customer can reach. Order: `PUBLIC_API_URL`, `APP_URL`, `WEB_APP_URL`, then `API_URL` only when it is a public host
 * (local development), else the local default.
 */
const LOCAL_DEFAULT = 'http://localhost:3000';

/** A host a customer cannot reach: a single-label name (a Docker or Kubernetes service), or an `.internal` / `.local` / `.svc` name. */
export function isInternalHost(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return false;
  if (!host.includes('.') && !host.includes(':')) return true;
  return /\.(internal|local|svc|cluster\.local)$/.test(host);
}

export function publicApiOrigin(env: Record<string, string | undefined> = process.env): string {
  const set = [env.PUBLIC_API_URL, env.APP_URL, env.WEB_APP_URL].find((v) => v && v.trim());
  if (set) return set.trim();
  const proxy = env.API_URL?.trim();
  if (proxy && !isInternalHost(proxy)) return proxy;
  return LOCAL_DEFAULT;
}
