/** The path, query and hash of `href` with the named query parameters removed (null when nothing was removed). */
export function withoutParams(href: string, names: readonly string[]): string | null {
  const url = new URL(href, 'http://relative.invalid');
  let removed = false;
  for (const name of names) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      removed = true;
    }
  }
  return removed ? `${url.pathname}${url.search}${url.hash}` : null;
}

/** Browser side: drop one-time flags (`?logout=1`, `?reset=1`) from the address bar so a reload does not repeat them. */
export function stripSearchParams(names: readonly string[]): void {
  try {
    const next = withoutParams(window.location.href, names);
    if (next) window.history.replaceState(window.history.state, '', next);
  } catch {
    /* address bar left as is */
  }
}
