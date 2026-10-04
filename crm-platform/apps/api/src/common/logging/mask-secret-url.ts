/**
 * The address of a push portal's connection carries its secret as the LAST path segment (`/v2/public/marketplace/hooks/<publicKey>/<secret>`):
 * IndiaMART allows an identifier in the path and JustDial's team configures a URL and nothing else, so the address IS the credential. A secret
 * must never reach a log line, so every place that logs a request address goes through this.
 */
const MARKETPLACE_HOOK_SECRET = /(\/public\/marketplace\/hooks\/[0-9a-f]{32}\/)[^/?#\s]+/i;

export function maskSecretUrl(url: string): string;
export function maskSecretUrl(url: string | undefined): string | undefined;
export function maskSecretUrl(url: string | undefined): string | undefined {
  return url === undefined ? undefined : url.replace(MARKETPLACE_HOOK_SECRET, '$1[secret]');
}
