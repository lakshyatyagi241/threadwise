/**
 * Request headers that carry a credential or a signature, and so never belong in a log line or an error report.
 *
 * Found by listing every header the API reads (`@Headers`, `req.header`): the first group authenticates a caller, the second
 * is the shared secret a provider or the bridge sends, the third the HMAC a provider computes over the body (a signature is not
 * a secret, but a logged one can be replayed inside its window).
 */
export const SECRET_HEADERS = [
  // who the caller is
  'authorization',
  'cookie',
  'x-api-key',
  'x-workspace-token',
  'x-node-token',
  'x-shopify-access-token',
  // shared secrets
  'x-webhook-secret',
  'x-instaflow-secret',
  'x-telegram-bot-api-secret-token',
  // body signatures
  'x-hub-signature-256',
  'x-shopify-hmac-sha256',
  'x-wc-webhook-signature',
  'x-razorpay-signature',
  'x-invoice-signature',
  'x-signature',
  'stripe-signature',
] as const;

/** pino `redact.paths` for the HTTP logger: every secret header on the request, and cookies set on the response. */
export const LOG_REDACT_PATHS: string[] = [
  ...SECRET_HEADERS.map((h) => `req.headers["${h}"]`),
  'req.body.password',
  'req.body.credentials',
  'res.headers["set-cookie"]',
];

const SECRET_HEADER_SET: ReadonlySet<string> = new Set(SECRET_HEADERS);

/** A copy of a header map with the secret ones replaced. Header names are matched case-insensitively. */
export function redactHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SECRET_HEADER_SET.has(name.toLowerCase()) ? '[redacted]' : value,
    ]),
  );
}
