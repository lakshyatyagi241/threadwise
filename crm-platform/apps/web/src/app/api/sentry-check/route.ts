// TEMPORARY: throws on purpose so Sentry shows a server-side stack trace. Remove with the sentry-check page.
export const dynamic = 'force-dynamic';

function explodeOnServer(): never {
  throw new Error('Sentry check (server): safe to ignore, thrown on purpose to verify source maps');
}

export function GET() {
  explodeOnServer();
}
