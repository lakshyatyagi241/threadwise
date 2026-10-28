import type { BffAuthenticated } from './schemas';
import { postLoginTarget } from './next-path';
import { rememberOrg } from './org-cookie';
import { showTransitionLoader } from '../shared/transition-loader';

/**
 * The session cookies are already set by the sign-in route. Remember the workspace, then leave with a full
 * navigation: a new identity must not inherit the router cache of the previous one. The destination is the safe
 * return path, else `/` (the home router, which applies `homePathFor`).
 */
export function completeSignIn(res: Pick<BffAuthenticated, 'orgSlug'>, next?: string | null): void {
  rememberOrg(res.orgSlug);
  showTransitionLoader();
  window.location.replace(postLoginTarget(next));
}
