import { notFound } from 'next/navigation';

/**
 * Any address no screen owns. Throwing `notFound()` here (inside the signed-in layout) draws `(app)/not-found.tsx` in the shell,
 * with the menu and a way back, and answers 404; a bare root 404 would have left a signed-in person with nothing to click.
 * Static routes always win over this catch-all, so it never hides a real screen.
 */
export default function UnknownRoute(): never {
  notFound();
}
