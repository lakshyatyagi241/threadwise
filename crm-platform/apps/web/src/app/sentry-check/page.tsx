import { SentryCheckButtons } from './buttons';

// TEMPORARY: lets a person trigger one browser error and one server error to confirm Sentry shows readable stack traces.
// Remove together with api/sentry-check once source maps are confirmed.
export const dynamic = 'force-dynamic';

export default function SentryCheckPage() {
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Sentry check</h1>
      <SentryCheckButtons />
    </main>
  );
}
