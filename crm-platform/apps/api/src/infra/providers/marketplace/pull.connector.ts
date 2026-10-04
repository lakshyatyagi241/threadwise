import { createHmac } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { recipePlaceholdersOf, type MarketRecipe, type PullWindow } from '@crm/contracts';
import { assertPublicUrl } from '../whatsapp-cloud-api-waba/provider-url-guard';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorProblem,
  type ConnectorTestResult,
  type InboundDescription,
  type InboundRequest,
  type InboundConnectorType,
  type ParsedDelivery,
  type PullConnectorType,
  type PullResult,
  type PullState,
} from './connector.port';
import { pathTokenMatches } from './hook-auth';
import { formatWindowTime, narrowerSpan, planWindow, type WindowPlan } from './pull-window';
import { mapDelivery, mapItems, readPath } from './recipe-mapper';

/** The slice of `fetch` the connector uses. Replaced in tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    /** A redirect is never followed: the host the recipe names is the only host this connector talks to. */
    redirect?: 'manual';
  },
) => Promise<{
  status: number;
  text(): Promise<string>;
  /** Only `retry-after` is read. */
  headers?: { get(name: string): string | null };
  /** The answer was longer than the cap and `text()` holds only its start. */
  truncated?: boolean;
}>;
export const MARKET_FETCH = Symbol('MARKET_FETCH');

/** Checks where a host name points, right before the call. Replaced in tests. */
export type UrlGuard = (url: string) => Promise<void>;
export const MARKET_URL_GUARD = Symbol('MARKET_URL_GUARD');

/** Waits between the pages of one poll (the portal's requests-per-minute limit). Replaced in tests. */
export type Sleep = (ms: number) => Promise<void>;
export const MARKET_SLEEP = Symbol('MARKET_SLEEP');

const TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

type Vars = {
  cred: Record<string, string>;
  config: Record<string, unknown>;
  cursor: string;
  since_iso: string;
  now_iso: string;
  now_epoch?: string;
  window_start?: string;
  window_end?: string;
};

/** The real `fetch`, with the answer read only up to the cap (a hostile or broken portal cannot make a worker hold a huge body). */
async function boundedFetch(url: string, init: Parameters<FetchLike>[1]): ReturnType<FetchLike> {
  const res = await fetch(url, { ...init, redirect: 'manual' });
  let text = '';
  let truncated = false;
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        truncated = true;
        text += decoder.decode(value.subarray(0, value.byteLength - (bytes - MAX_RESPONSE_BYTES)));
        await reader.cancel().catch(() => undefined);
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  }
  return { status: res.status, text: async () => text, headers: res.headers, truncated };
}

/** `{{cred.apiKey}}` -> the value, URL-encoded when it goes into a path or query. A missing value is empty, never the literal placeholder. */
export function renderTemplate(template: string, vars: Vars, encode: boolean): string {
  return template.replace(/\{\{\s*([a-z_]+(?:\.[A-Za-z0-9_]+)?)\s*\}\}/g, (_m, name: string) => {
    let v: unknown;
    if (name.startsWith('cred.')) v = vars.cred[name.slice(5)];
    else if (name.startsWith('config.')) v = vars.config[name.slice(7)];
    else v = (vars as unknown as Record<string, unknown>)[name];
    const s = v === undefined || v === null ? '' : String(v);
    return encode ? encodeURIComponent(s) : s;
  });
}

/**
 * What a recipe's error mapping says about a failed answer; with no matching rule, a sensible default by status. `status` is the status
 * the recipe sees: the HTTP status, or the number a portal puts in its body when the recipe names a `statusPath`.
 */
export function classifyHttpFailure(
  recipe: MarketRecipe,
  status: number,
  body: string,
  retryAfterHeader?: string | null,
): ConnectorError {
  const lower = body.toLowerCase();
  const headerWait = Number(retryAfterHeader);
  const fromHeader =
    Number.isFinite(headerWait) && headerWait > 0
      ? Math.min(Math.ceil(headerWait), 86_400)
      : undefined;
  for (const m of recipe.errorMapping) {
    const byStatus = m.status !== undefined ? m.status === status : undefined;
    const byRange = m.statusRange
      ? status >= m.statusRange[0] && status <= m.statusRange[1]
      : undefined;
    const byBody = m.bodyContains ? lower.includes(m.bodyContains.toLowerCase()) : undefined;
    const tests = [byStatus, byRange, byBody].filter((t): t is boolean => t !== undefined);
    if (tests.length > 0 && tests.every(Boolean))
      return new ConnectorError(
        m.code,
        m.message,
        m.retry,
        m.health,
        m.retryAfterSeconds ?? fromHeader,
      );
  }
  if (status === 401 || status === 403) {
    return new ConnectorError(
      'auth_rejected',
      'The portal refused the saved credentials.',
      false,
      'needs_reauth',
    );
  }
  if (status === 429)
    return new ConnectorError(
      'rate_limited',
      'The portal asked us to slow down.',
      true,
      'degraded',
      fromHeader,
    );
  if (status >= 300 && status < 400)
    return new ConnectorError(
      'portal_redirect',
      'The portal answered with a redirect, which is not followed.',
      false,
      'error',
    );
  if (status >= 500)
    return new ConnectorError(
      'portal_error',
      `The portal answered ${status}.`,
      true,
      'degraded',
      fromHeader,
    );
  return new ConnectorError('portal_rejected', `The portal answered ${status}.`, false, 'error');
}

/** The greatest value of `path` among the items, as the next poll's cursor. Numbers compare as numbers, everything else as text. */
function nextCursorOf(items: unknown[], path: string, previous: string | null): string | null {
  let best: string | number | null = null;
  for (const it of items) {
    const v = readPath(it, path);
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    if (
      best === null ||
      (typeof v === 'number' && typeof best === 'number' ? v > best : String(v) > String(best))
    )
      best = v;
  }
  return best === null ? previous : String(best);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The list of leads in a portal's answer: the recipe's `itemsPath`; without one, the answer itself when it is a list, or the one list an
 * object holds (a wrapper whose key nobody documented), or the object itself as a single lead.
 */
function itemsOf(json: unknown, path: string | undefined): unknown[] {
  if (path) {
    const at = readPath(json, path);
    return Array.isArray(at) ? at : at === undefined || at === null ? [] : [at];
  }
  if (Array.isArray(json)) return json;
  if (isPlainObject(json)) {
    const lists = Object.values(json).filter(Array.isArray);
    if (lists.length === 1) return lists[0] as unknown[];
    return [json];
  }
  return [];
}

function cursorDate(cursor: string | null): Date | null {
  if (!cursor) return null;
  const d = new Date(cursor);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface RequestOutcome {
  items: unknown[];
  truncated: boolean;
}

/**
 * Pull (we poll the portal's API with the customer's key on a schedule), made real for the portals that document one (IndiaMART, Housing.com,
 * TradeIndia): a templated request (path, query, headers, body), a signature when the portal wants one (HMAC of the request time), the
 * window of time to ask for with the connection's high-water mark and overlap, paging inside a window, the portal's own status in its
 * body when it keeps one there, the recipe's error mapping, the portal's stated penalties, and the address guard right before every call
 * (https, a public host, the recipe's own host only, redirects never followed, the answer read up to a cap).
 *
 * The connection's SCHEDULE (the minimum interval, requests per minute, back-off, the cursor itself) is kept by `PullRunService`; this class
 * makes one poll and says what it found. A recipe that also declares `push` makes the same connection receive deliveries: the connection
 * has a public address whose secret is in its path, read by the same mapping.
 */
@Injectable()
export class PullConnector implements PullConnectorType, InboundConnectorType {
  readonly kind = 'pull' as const;
  readonly implemented = true;
  /** Receives deliveries for a recipe that declares `push` (see `describeAuth`); a recipe without one has no public address. */
  readonly inbound = true;
  readonly polls = true;

  private readonly fetchImpl: FetchLike;
  private readonly guard: UrlGuard;
  private readonly sleep: Sleep;

  constructor(
    @Optional() @Inject(MARKET_FETCH) fetchImpl?: FetchLike,
    @Optional() @Inject(MARKET_URL_GUARD) guard?: UrlGuard,
    @Optional() @Inject(MARKET_SLEEP) sleep?: Sleep,
  ) {
    this.fetchImpl = fetchImpl ?? boundedFetch;
    this.guard = guard ?? ((url) => assertPublicUrl(url));
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  checkRecipe(recipe: MarketRecipe): ConnectorProblem[] {
    const c = recipe.connector;
    if (c.type !== 'pull')
      return [{ path: 'connector.type', message: 'This is not a pull recipe.' }];
    const problems: ConnectorProblem[] = [];
    if (c.cursor && !recipePlaceholdersOf(JSON.stringify(c.request)).includes('cursor')) {
      problems.push({
        path: 'connector.request',
        message: 'A cursor is declared but the request never uses {{cursor}}.',
      });
    }
    if (c.maxItemsPerPoll < (c.pagination?.pageSize ?? 1)) {
      problems.push({
        path: 'connector.maxItemsPerPoll',
        message: 'A poll takes at least one page.',
      });
    }
    return problems;
  }

  // --- the public address of a recipe that also receives -------------------------------------------------------------------------------

  describeAuth(recipe: MarketRecipe): InboundDescription | null {
    const c = recipe.connector;
    if (c.type !== 'pull' || !c.push) return null;
    return {
      auth: 'path',
      tokenHeader: '',
      signatureHeader: '',
      methods: c.push.delivery.methods,
      formats: c.push.delivery.formats,
      mode: c.push.delivery.mode,
    };
  }

  authenticate(_recipe: MarketRecipe, req: InboundRequest, secret: string): boolean {
    return pathTokenMatches(secret, req.pathToken);
  }

  secretFor(
    recipe: MarketRecipe,
    _credentials: Record<string, string>,
    connectionSecret: string | null,
  ): string | null {
    return recipe.connector.type === 'pull' && recipe.connector.push ? connectionSecret : null;
  }

  parse(recipe: MarketRecipe, body: unknown): ParsedDelivery {
    return mapDelivery(recipe, body);
  }

  // --- one poll --------------------------------------------------------------------------------------------------------------------------

  async pull(ctx: ConnectorContext, state: PullState): Promise<PullResult> {
    const c = ctx.recipe.connector;
    if (c.type !== 'pull')
      throw new ConnectorError('wrong_type', 'Not a pull recipe.', false, 'error');

    let plan: WindowPlan | null = null;
    if (c.window) {
      plan = state.test
        ? this.testWindow(c.window, state.now)
        : planWindow(c.window, cursorDate(state.cursor), state.now, state.windowSeconds);
      if (plan.empty) {
        return {
          leads: [],
          rejected: [],
          nextCursor: null,
          windowEnd: plan.end,
          behind: false,
          windowSeconds: null,
          fetched: 0,
        };
      }
    }
    const spanSeconds = plan
      ? Math.round((plan.end.getTime() - plan.start.getTime()) / 1000)
      : null;

    const vars: Vars = {
      cred: ctx.credentials,
      config: ctx.config,
      cursor: state.cursor ?? '',
      since_iso: (state.since ?? new Date(state.now.getTime() - 24 * 3600 * 1000)).toISOString(),
      now_iso: state.now.toISOString(),
      now_epoch: String(Math.floor(state.now.getTime() / 1000)),
      window_start:
        plan && c.window
          ? formatWindowTime(plan.start, c.window.format, c.window.utcOffsetMinutes)
          : '',
      window_end:
        plan && c.window
          ? formatWindowTime(plan.end, c.window.format, c.window.utcOffsetMinutes)
          : '',
    };

    const paging = c.pagination;
    const items: unknown[] = [];
    let truncated = false;
    const pages = paging ? paging.maxPages : 1;
    for (let page = 0; page < pages; page++) {
      if (page > 0) await this.sleep(Math.ceil(60_000 / c.limits.requestsPerMinute));
      const out = await this.requestOnce(
        ctx.recipe,
        c,
        vars,
        state.now,
        paging ? { number: paging.startPage + page } : null,
      );
      if (out.truncated) {
        truncated = true;
        break;
      }
      items.push(...out.items);
      if (!paging || out.items.length < paging.pageSize) break;
      if (items.length > c.maxItemsPerPoll) break;
    }

    // More than one answer can carry: with a window, ask again for half of it (nothing is handed over now, so nothing is lost or counted
    // twice); with nothing narrower left, take what fits.
    if (c.window && (truncated || items.length > c.maxItemsPerPoll)) {
      if (narrowerSpan(c.window, spanSeconds) !== null) {
        return {
          leads: [],
          rejected: [],
          nextCursor: null,
          windowEnd: plan!.end,
          behind: true,
          overflow: true,
          windowSeconds: spanSeconds,
          fetched: items.length,
        };
      }
    }
    if (truncated) {
      throw new ConnectorError(
        'response_too_large',
        'The portal answered more than the platform reads at once.',
        true,
        'degraded',
      );
    }

    const taken = items.slice(0, c.maxItemsPerPoll);
    const parsed = mapItems(ctx.recipe, taken);
    return {
      leads: parsed.leads,
      rejected: parsed.rejected,
      nextCursor: c.cursor ? nextCursorOf(taken, c.cursor.from, state.cursor) : null,
      windowEnd: plan ? plan.end : null,
      behind: plan ? plan.behind : false,
      windowSeconds: spanSeconds,
      fetched: items.length,
    };
  }

  private testWindow(w: PullWindow, now: Date): WindowPlan {
    const start = new Date(now.getTime() - Math.min(3600, w.initialLookbackSeconds) * 1000);
    return { start, end: now, behind: false, clamped: false, empty: false };
  }

  private async requestOnce(
    recipe: MarketRecipe,
    c: Extract<MarketRecipe['connector'], { type: 'pull' }>,
    vars: Vars,
    now: Date,
    page: { number: number } | null,
  ): Promise<RequestOutcome> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(c.request.query))
      query.set(k, renderTemplate(v, vars, false));
    if (c.request.sign) {
      // The time of this very request, whole seconds as a decimal string; the signature is HMAC-SHA256 of it, hex.
      const stamp = String(Math.floor(now.getTime() / 1000));
      const key = vars.cred[c.request.sign.keyField] ?? '';
      query.set(c.request.sign.timestampParam, stamp);
      query.set(
        c.request.sign.signatureParam,
        createHmac('sha256', key).update(stamp).digest('hex'),
      );
    }
    if (c.pagination && page) {
      query.set(c.pagination.pageParam, String(page.number));
      if (c.pagination.sizeParam) query.set(c.pagination.sizeParam, String(c.pagination.pageSize));
    }
    const qs = query.toString();
    const url = `${c.request.baseUrl}${renderTemplate(c.request.path, vars, true)}${qs ? `?${qs}` : ''}`;
    const headers = Object.fromEntries(
      Object.entries(c.request.headers).map(([k, v]) => [k, renderTemplate(v, vars, false)]),
    );
    let body: string | undefined;
    if (c.request.method === 'POST' && c.request.body) {
      headers['content-type'] ??= 'application/json';
      body = JSON.stringify(
        Object.fromEntries(
          Object.entries(c.request.body).map(([k, v]) => [k, renderTemplate(v, vars, false)]),
        ),
      );
    }

    // Right before the connection, not only when the recipe was saved; and the host is the recipe's own host, nothing a value could change.
    try {
      await this.guard(c.request.baseUrl);
      if (new URL(url).hostname !== new URL(c.request.baseUrl).hostname) throw new Error('host');
    } catch {
      throw new ConnectorError('url_refused', 'The portal address is not allowed.', false, 'error');
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let status: number;
    let text: string;
    let retryAfter: string | null = null;
    let truncated = false;
    try {
      const res = await this.fetchImpl(url, {
        method: c.request.method,
        headers,
        body,
        signal: abort.signal,
        redirect: 'manual',
      });
      status = res.status;
      text = (await res.text()).slice(0, MAX_RESPONSE_BYTES);
      truncated = res.truncated === true;
      retryAfter = res.headers?.get('retry-after') ?? null;
    } catch {
      throw new ConnectorError(
        'portal_unreachable',
        'The portal did not answer in time.',
        true,
        'degraded',
      );
    } finally {
      clearTimeout(timer);
    }
    if (truncated) return { items: [], truncated: true };

    const empty = c.response.emptyStatuses;
    if (empty.includes(status)) return { items: [], truncated: false };
    if (status >= 300) throw classifyHttpFailure(recipe, status, text, retryAfter);

    const trimmed = text.trim();
    if (trimmed === '') return { items: [], truncated: false };
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new ConnectorError(
        'bad_answer',
        'The portal answered something that is not JSON.',
        true,
        'degraded',
      );
    }

    // A portal that answers 200 and keeps its own status in the body (IndiaMART).
    if (c.response.statusPath) {
      const raw = readPath(json, c.response.statusPath);
      const code =
        typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
      if (Number.isInteger(code)) {
        if (empty.includes(code)) return { items: [], truncated: false };
        if (code >= 300 || code < 200) throw classifyHttpFailure(recipe, code, text, retryAfter);
      }
    }
    const itemsPath =
      c.response.itemsPath ??
      (recipe.mapping.mode === 'explicit' ? recipe.mapping.itemsPath : undefined);
    return { items: itemsOf(json, itemsPath), truncated: false };
  }

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    try {
      await this.pull(ctx, { cursor: null, since: null, now: new Date(), test: true });
      return { ok: true, code: null, message: null };
    } catch (e) {
      if (e instanceof ConnectorError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  }
}
