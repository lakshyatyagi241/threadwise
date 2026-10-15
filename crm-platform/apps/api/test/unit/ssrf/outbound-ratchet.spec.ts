import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bridgeHostAllowed,
  nodeBridgeTestRequestSchema,
  updateNodeBridgeSchema,
} from '@crm/contracts';
import { isMetaUrl } from '../../../src/infra/providers/channel-facebook/facebook-graph.client';

const SRC = join(__dirname, '../../../src');

/**
 * A bare `fetch(...)` follows redirects, so a host the caller trusts can bounce the request (and its Authorization header) to another
 * one. Every call under src/ must say `redirect:` or go through guardedRequest / SafeFetch. The files below are the ones reviewed
 * on 2026-10-15 and left as they are, each for a stated reason. A NEW file with a bare fetch fails this test: fix it, or review it and
 * add it here with the reason.
 */
const REVIEWED_BARE_FETCH: Record<string, string> = {
  'infra/providers/ai-agents-training/http-training-url-fetcher.adapter.ts':
    'wraps safeGet, which re-checks every hop',
  'infra/providers/ai-agents-training/training-url-fetcher.port.ts': 'port type only',
  'infra/providers/appointments-booking/google-calendar.client.ts':
    'fixed Google host (env override is deploy-time)',
  'infra/providers/auth-registration-security/recaptcha.adapter.ts': 'fixed Google host',
  'infra/providers/auth-registration-security/social-oauth.adapters.ts':
    'fixed Google / Facebook hosts',
  'infra/providers/channel-email/google-http.ts': 'fixed Google hosts',
  'infra/providers/channel-email/google-oidc.verifier.ts':
    'fixed Google JWKS URL (env override is deploy-time)',
  'infra/providers/channel-email/microsoft-http.ts':
    'fixed Microsoft Graph host; follow-up: a Graph nextLink/deltaLink is followed with the token, so check its host and set redirect manual',
  'infra/providers/channel-line/line-api.client.ts': 'fixed api.line.me and api-data.line.me',
  'infra/providers/growth-enrichment/growth-enrichment.adapters.ts': 'fixed api.apollo.io',
  'infra/providers/help-agent/http-help-agent-llm.adapter.ts':
    'fixed vendor hosts (env override is deploy-time)',
  'infra/providers/lead-scoring/openrouter-lead-scoring-ai.adapter.ts':
    'fixed openrouter.ai (env override is deploy-time)',
  'infra/providers/campaigns/http-campaign-ai.adapter.ts':
    'fixed vendor hosts (env override is deploy-time)',
  'infra/providers/channel-telegram/telegram-bot-api.client.ts': 'fixed api.telegram.org',
  'infra/providers/chatbot-widget/http-ai-chat.adapter.ts':
    'fixed vendor hosts (env override is deploy-time)',
  'infra/providers/coupons-credits-referral-currency/open-er-api.adapter.ts':
    'fixed rates host (env override is deploy-time)',
  'infra/providers/faq-knowledge/openrouter-faq-ai.adapter.ts':
    'fixed openrouter.ai (env override is deploy-time)',
  'infra/providers/flow-runtime-engine/http-flow-ai.adapter.ts':
    'fixed vendor hosts (env override is deploy-time)',
  'infra/providers/platform-payment-gateways/payment-driver.ts':
    'gateway drivers; follow-up: confirm no driver takes a tenant base URL',
  'infra/providers/whatsapp-cloud-api-waba/waba-http.ts':
    'provider base URL checked by assertPublicUrl before every call',
  'modules/chatbot-widget/chat-page.ts': 'browser script inside a page template, not a server call',
  'modules/install-update-licensing/install-update-licensing.module.ts':
    'only provides the injectable; the one consumer uses a constant Envato URL',
  'modules/node-bridge-runtime/outbound/twilio.transport.ts': 'fixed api.twilio.com',
};

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (p.endsWith('.ts')) yield p;
  }
}
/** Bare fetch calls: `fetch(` whose balanced argument text never mentions `redirect`. */
function bareFetchCalls(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/(?<![\w.])fetch\(/g)) {
    let i = m.index! + m[0].length;
    for (let depth = 1; i < text.length && depth > 0; i++)
      depth += (text[i] === '(' ? 1 : 0) - (text[i] === ')' ? 1 : 0);
    if (!text.slice(m.index!, i).includes('redirect')) n++;
  }
  return n;
}

describe('outbound fetch ratchet', () => {
  const offenders = [...sources(SRC)]
    .map(
      (p) =>
        [relative(SRC, p).split(sep).join('/'), bareFetchCalls(readFileSync(p, 'utf8'))] as const,
    )
    .filter(([, n]) => n > 0)
    .map(([f]) => f);

  it('no source file has a bare fetch that was not reviewed', () => {
    expect(offenders.filter((f) => !(f in REVIEWED_BARE_FETCH))).toEqual([]);
  });
  it('the review list has no stale entries', () => {
    expect(Object.keys(REVIEWED_BARE_FETCH).filter((f) => !offenders.includes(f))).toEqual([]);
  });
});

describe('Meta addresses stay on Meta', () => {
  it.each([
    'https://graph.facebook.com/v19.0/me/accounts?after=x',
    'https://rupload.facebook.com/video',
  ])('allows %s', (u) => expect(isMetaUrl(new URL(u))).toBe(true));
  it.each([
    'http://graph.facebook.com/x',
    'https://evil.example/x',
    'https://graph.facebook.com.evil.example/x',
    'https://facebook.com.evil.example/',
    'https://user@graph.facebook.com/x',
    'https://169.254.169.254/',
    'https://notfacebook.com/',
  ])('refuses %s', (u) => expect(isMetaUrl(new URL(u))).toBe(false));
});

describe('the node bridge address', () => {
  it.each([
    'http://localhost:3000',
    'http://10.0.0.5:3000',
    'https://bridge.example.com',
    'http://192.168.1.4',
  ])('allows %s', (u) => expect(bridgeHostAllowed(u)).toBe(true));
  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/',
    'http://foo.internal',
    'http://[fe80::1]/',
    'http://[fd00:ec2::254]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://user@169.254.169.254/',
  ])('refuses %s', (u) => expect(bridgeHostAllowed(u)).toBe(false));
  it('is enforced on save and on test', () => {
    expect(
      updateNodeBridgeSchema.safeParse({ serverUrl: 'http://169.254.169.254', rowVersion: 0 })
        .success,
    ).toBe(false);
    expect(
      updateNodeBridgeSchema.safeParse({ serverUrl: 'http://localhost:3000', rowVersion: 0 })
        .success,
    ).toBe(true);
    expect(nodeBridgeTestRequestSchema.safeParse({ serverUrl: 'ftp://x' }).success).toBe(false);
    expect(
      nodeBridgeTestRequestSchema.safeParse({ serverUrl: 'http://169.254.169.254' }).success,
    ).toBe(false);
    expect(
      nodeBridgeTestRequestSchema.safeParse({ serverUrl: 'https://bridge.example.com' }).success,
    ).toBe(true);
  });
});
