'use client';

function explodeInBrowser(): never {
  throw new Error(
    'Sentry check (browser): safe to ignore, thrown on purpose to verify source maps',
  );
}

export function SentryCheckButtons() {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <button type="button" onClick={() => explodeInBrowser()}>
        Throw browser error
      </button>
      <button type="button" onClick={() => void fetch('/api/sentry-check', { cache: 'no-store' })}>
        Throw server error
      </button>
    </div>
  );
}
