import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../../src');

/**
 * An outbound HTTP call with no timeout can wait forever: when the other side stalls, the worker or request that made it is held for as
 * long as the other side likes. Every `fetch(` and `http(s).request(` under src/ must carry a timeout or an abort signal in its own
 * arguments. The files below are reviewed exceptions, each for a stated reason. A NEW call without a timeout fails here: give it one, or
 * review it and add it with the reason.
 */
const REVIEWED_WITHOUT_TIMEOUT: Record<string, string> = {
  'infra/providers/ai-agents-training/http-training-url-fetcher.adapter.ts':
    'a method named fetch; the socket call passes timeoutMs to safeGet',
  'infra/providers/ai-agents-training/training-url-fetcher.port.ts': 'port type only',
  'infra/providers/marketplace/pull.connector.ts':
    'the caller passes an AbortController signal that also covers reading the body',
  'infra/providers/whatsapp-cloud-api-waba/waba-http.ts':
    'a thin wrapper; send() builds the init with AbortSignal.timeout',
  'modules/chatbot-widget/chat-page.ts': 'browser script inside a page template, not a server call',
  'modules/install-update-licensing/install-update-licensing.module.ts':
    'only provides the injectable; the consumer passes AbortSignal.timeout',
};

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

function callsWithoutTimeout(text: string): number {
  let n = 0;
  const call =
    /(?<![\w.])(fetch|httpsRequest|httpRequest|https\.request|http\.request|doRequest)\(/g;
  for (const m of text.matchAll(call)) {
    let i = m.index! + m[0].length;
    for (let depth = 1; i < text.length && depth > 0; i++)
      depth += (text[i] === '(' ? 1 : 0) - (text[i] === ')' ? 1 : 0);
    if (!/signal|timeout|AbortSignal|Timeout/.test(text.slice(m.index!, i))) n++;
  }
  return n;
}

describe('every outbound call has a timeout', () => {
  const offenders = [...sources(SRC)]
    .map(
      (p) =>
        [relative(SRC, p).split(sep).join('/'), callsWithoutTimeout(readFileSync(p, 'utf8'))] as const,
    )
    .filter(([, n]) => n > 0)
    .map(([f]) => f);

  it('no source file has an outbound call without a timeout that was not reviewed', () => {
    expect(offenders.filter((f) => !(f in REVIEWED_WITHOUT_TIMEOUT))).toEqual([]);
  });
  it('the review list has no stale entries', () => {
    expect(Object.keys(REVIEWED_WITHOUT_TIMEOUT).filter((f) => !offenders.includes(f))).toEqual([]);
  });
});
