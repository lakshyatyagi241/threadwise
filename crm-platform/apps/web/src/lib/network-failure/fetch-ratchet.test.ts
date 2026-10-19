import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../..');

/**
 * A `fetch` with no deadline waits for as long as the other side likes: a stalled API leaves a spinner, a frozen sign-out, or (on the
 * server) a page render that never finishes. Every `fetch(` under src/ must carry a `signal` or timeout in its own arguments, or be
 * `upstreamFetch` (the server-side helper with a first-byte deadline). The files below are reviewed exceptions, each for a stated
 * reason. A NEW call without a deadline fails here: give it one, or review it and add it with the reason.
 *
 * Retry safety, for the record: nothing here retries a request by itself except `transientRetry` (lib/api/retry.ts), which wraps reads
 * only. A mutation that times out is never replayed automatically; the person decides, and `apiFetch` sends a fresh Idempotency-Key per
 * attempt, so a repeat after an ambiguous timeout is the person's call.
 */
const UPLOAD =
  'multipart upload of a user file: duration follows the file size, and the person can cancel by leaving the page';
const DOWNLOAD =
  'streamed export or file download: it can be large and runs as long as the transfer does; the server side of the proxy already bounds the wait for the first byte';
const REVIEWED_WITHOUT_DEADLINE: Record<string, string> = {
  'features/addons-extension-registry/api.ts': UPLOAD,
  'features/admin-console-shell/workspace-settings/api.ts': UPLOAD,
  'features/appointments/api/page-theme-service.ts': UPLOAD,
  'features/auth-registration-security/account/api.ts': UPLOAD,
  'features/chatbot-widget/api/widgets.ts': UPLOAD,
  'features/flow-builder-editor/lib/upload-media.ts': UPLOAD,
  'features/platform-payment-gateways/api.ts': UPLOAD,
  'features/platform-payment-gateways/billing-api.ts': UPLOAD,
  'features/platform-settings-branding-storage/components/brand-assets.tsx': UPLOAD,
  'features/whatsapp-devices-baileys/api/groups-service.ts': UPLOAD,
  'features/team-inbox-conversations/api/saved-replies.ts': `${UPLOAD} (import) and ${DOWNLOAD} (export)`,
  'features/calling-voice/api/calling.ts': DOWNLOAD,
  'features/campaigns/api/campaigns.ts': DOWNLOAD,
  'features/campaigns/earlier/api/broadcasts.ts': DOWNLOAD,
  'features/campaigns/wizard/api/wizard.ts': `${DOWNLOAD} (rejected rows) and ${UPLOAD} (recipients CSV)`,
  'features/contacts-attributes-tags/api/import-export.ts': DOWNLOAD,
  'features/coupons-credits-referral-currency/api.ts': DOWNLOAD,
  'features/message-history/api/history.ts': DOWNLOAD,
  'features/platform-settings-branding-storage/lib/sitemap-download.ts': DOWNLOAD,
  'features/platform-support-desk/lib/format.ts': DOWNLOAD,
  'features/segments/api/segments.ts': DOWNLOAD,
  'features/team-inbox-conversations/api/service.ts': DOWNLOAD,
  'features/wallet-message-billing/api.ts': DOWNLOAD,
  'features/web-forms/api/forms.ts': DOWNLOAD,
  'features/flow-builder-editor/api/flows.ts':
    'AI flow generation: one LLM call that legitimately runs for a minute or more; the proxy bounds the first byte and the modal has a cancel',
  'features/web-forms/public/api.ts':
    'analytics beacon (keepalive, fire and forget, errors swallowed); the other calls in the file carry a deadline',
  'features/help-agent/lib/failure.ts':
    'an injectable wrapper (deps.fetchImpl); the real call is made by the caller, which passes its own signal',
};

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(ts|tsx)$/.test(p) && !/\.(test|spec)\.|\.d\.ts$/.test(p)) yield p;
  }
}

function callsWithoutDeadline(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/(?<![\w.])fetch\(/g)) {
    let i = m.index! + m[0].length;
    for (let depth = 1; i < text.length && depth > 0; i++)
      depth += (text[i] === '(' ? 1 : 0) - (text[i] === ')' ? 1 : 0);
    if (!/signal|timeout|Timeout|AbortSignal/.test(text.slice(m.index!, i))) n++;
  }
  return n;
}

describe('every fetch in the web app has a deadline', () => {
  const offenders = [...sources(SRC)]
    .map(
      (p) =>
        [
          relative(SRC, p).split(sep).join('/'),
          callsWithoutDeadline(readFileSync(p, 'utf8')),
        ] as const,
    )
    .filter(([, n]) => n > 0)
    .map(([f]) => f);

  it('no source file has a fetch without a deadline that was not reviewed', () => {
    expect(offenders.filter((f) => !(f in REVIEWED_WITHOUT_DEADLINE))).toEqual([]);
  });
  it('the review list has no stale entries', () => {
    expect(Object.keys(REVIEWED_WITHOUT_DEADLINE).filter((f) => !offenders.includes(f))).toEqual(
      [],
    );
  });
  it('server-side calls to the API go through upstreamFetch, not a bare fetch', () => {
    const bare = [...sources(SRC)]
      .filter((p) => {
        const t = readFileSync(p, 'utf8');
        const server = !/^\s*(\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(t);
        return server && t.includes('apiBase()') && callsWithoutDeadline(t) > 0;
      })
      .map((p) => relative(SRC, p).split(sep).join('/'));
    expect(bare).toEqual([]);
  });
});
