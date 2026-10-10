import { Redirect } from 'expo-router';

/** An unknown deep link (an old email link, a mistyped URL) lands on the start screen instead of an error page. */
export default function NotFound() {
  return <Redirect href="/" />;
}
