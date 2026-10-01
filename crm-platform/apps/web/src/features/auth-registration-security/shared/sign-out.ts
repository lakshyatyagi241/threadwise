/**
 * Ends the session (the BFF revokes it server-side and clears the cookies),
 * then does a full navigation to the sign-in page so no client cache of the
 * old account survives.
 */
export async function signOut(to = '/login'): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* the cookies may still be set; the next request will be refused and land on /login */
  }
  window.location.assign(to);
}
