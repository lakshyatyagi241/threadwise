'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * The last resort: a rendering error that no nearer boundary caught. Reports it and shows a plain page; the layout (and with
 * it the theme and translations) failed, so this must not depend on either.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: '15vh auto',
          maxWidth: 480,
          padding: 24,
        }}
      >
        <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
        <p style={{ color: '#555' }}>
          The page failed to load. It has been reported. Try again, and if it keeps happening
          contact support
          {error.digest ? ` and quote ${error.digest}` : ''}.
        </p>
        <a href="/">Back to the start</a>
      </body>
    </html>
  );
}
