/**
 * Ends the session (the BFF revokes it server-side and clears the cookies),
 * then does a full navigation to the sign-in page so no client cache of the
 * old account survives (the TanStack Query cache lives in the page's JavaScript and a soft `router.replace` keeps it: the next
 * person to sign in on the same tab would see the previous one's lists first). Every sign-out must go through here. `endpoint` is
 * the operator console's own sign-out route.
 */
export async function signOut(to = '/login', endpoint = '/api/auth/logout'): Promise<void> {
  try {
    await fetch(endpoint, {
      signal: AbortSignal.timeout(5000),
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    /* the cookies may still be set; the next request will be refused and land on /login */
  }
  window.location.assign(to);
}
