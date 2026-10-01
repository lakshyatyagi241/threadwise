import { redirect } from 'next/navigation';

/**
 * An unknown account pane falls back to the profile, as WaDesk does for an unknown `?tab=`.
 * Panes other domains add under /account/* are real routes and take precedence over this catch-all.
 */
export default function UnknownAccountPane() {
  redirect('/account/profile');
}
