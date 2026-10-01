/**
 * `?next=` after operator sign-in. Only a path inside the console is honoured, so the
 * sign-in page can never be turned into an open redirect.
 */
export function safeConsolePath(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!/^\/admin(?:\/[\w\-./]*)?(?:\?[\w\-./=&%]*)?$/.test(value)) return fallback;
  if (value.includes('//') || value.includes('..') || value.startsWith('/admin/login'))
    return fallback;
  return value;
}
