import { Inject, Injectable, Optional } from '@nestjs/common';
import { recipePlaceholdersOf, type MarketRecipe } from '@crm/contracts';
import { assertPublicUrl } from '../whatsapp-cloud-api-waba/provider-url-guard';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorProblem,
  type ConnectorTestResult,
  type PullConnectorType,
  type PullResult,
  type PullState,
} from './connector.port';
import { mapDelivery, readPath } from './recipe-mapper';

/** The slice of `fetch` the connector uses. Replaced in tests. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;
export const MARKET_FETCH = Symbol('MARKET_FETCH');

/** Checks where a host name points, right before the call. Replaced in tests. */
export type UrlGuard = (url: string) => Promise<void>;
export const MARKET_URL_GUARD = Symbol('MARKET_URL_GUARD');

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

type Vars = {
  cred: Record<string, string>;
  config: Record<string, unknown>;
  cursor: string;
  since_iso: string;
  now_iso: string;
};

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

/** What a recipe's error mapping says about a failed answer; with no matching rule, a sensible default by status. */
export function classifyHttpFailure(
  recipe: MarketRecipe,
  status: number,
  body: string,
): ConnectorError {
  const lower = body.toLowerCase();
  for (const m of recipe.errorMapping) {
    const byStatus = m.status !== undefined ? m.status === status : undefined;
    const byRange = m.statusRange
      ? status >= m.statusRange[0] && status <= m.statusRange[1]
      : undefined;
    const byBody = m.bodyContains ? lower.includes(m.bodyContains.toLowerCase()) : undefined;
    const tests = [byStatus, byRange, byBody].filter((t): t is boolean => t !== undefined);
    if (tests.length > 0 && tests.every(Boolean))
      return new ConnectorError(m.code, m.message, m.retry, m.health);
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
    );
  if (status >= 500)
    return new ConnectorError('portal_error', `The portal answered ${status}.`, true, 'degraded');
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

/**
 * Pull (we poll the portal's API with the customer's key on a schedule): the framework is complete (templated request, SSRF guard before
 * every call, size and time caps, the recipe's error mapping, mapping to leads, a cursor that resumes), but the type is registered as NOT
 * implemented. A real portal's request shape, answer shape and rate rules are verified against its own documentation when its recipe is
 * written (spec 6.4); until the first such recipe is checked, no listing of this type can be published, so nothing here is shown to a
 * workspace. Flip `implemented` with that first recipe.
 */
@Injectable()
export class PullConnector implements PullConnectorType {
  readonly kind = 'pull' as const;
  readonly implemented = false;
  readonly inbound = false;
  readonly polls = true;

  private readonly fetchImpl: FetchLike;
  private readonly guard: UrlGuard;

  constructor(
    @Optional() @Inject(MARKET_FETCH) fetchImpl?: FetchLike,
    @Optional() @Inject(MARKET_URL_GUARD) guard?: UrlGuard,
  ) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
    this.guard = guard ?? ((url) => assertPublicUrl(url));
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
    return problems;
  }

  async pull(ctx: ConnectorContext, state: PullState): Promise<PullResult> {
    const c = ctx.recipe.connector;
    if (c.type !== 'pull')
      throw new ConnectorError('wrong_type', 'Not a pull recipe.', false, 'error');
    const vars: Vars = {
      cred: ctx.credentials,
      config: ctx.config,
      cursor: state.cursor ?? '',
      since_iso: (state.since ?? new Date(state.now.getTime() - 24 * 3600 * 1000)).toISOString(),
      now_iso: state.now.toISOString(),
    };
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(c.request.query))
      query.set(k, renderTemplate(v, vars, false));
    const url = `${c.request.baseUrl}${renderTemplate(c.request.path, vars, true)}${query.toString() ? `?${query.toString()}` : ''}`;
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

    // Right before the connection, not only when the recipe was saved.
    try {
      await this.guard(c.request.baseUrl);
    } catch {
      throw new ConnectorError('url_refused', 'The portal address is not allowed.', false, 'error');
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let status: number;
    let text: string;
    try {
      const res = await this.fetchImpl(url, {
        method: c.request.method,
        headers,
        body,
        signal: abort.signal,
      });
      status = res.status;
      text = (await res.text()).slice(0, MAX_RESPONSE_BYTES);
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
    if (status >= 400) throw classifyHttpFailure(ctx.recipe, status, text);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ConnectorError(
        'bad_answer',
        'The portal answered something that is not JSON.',
        true,
        'degraded',
      );
    }
    const root = c.response.itemsPath ? readPath(json, c.response.itemsPath) : json;
    const items = (Array.isArray(root) ? root : root === undefined ? [] : [root]).slice(
      0,
      c.maxItemsPerPoll,
    );
    const parsed = mapDelivery(ctx.recipe, items);
    return {
      leads: parsed.leads,
      rejected: parsed.rejected,
      nextCursor: c.cursor ? nextCursorOf(items, c.cursor.from, state.cursor) : null,
    };
  }

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    try {
      await this.pull(ctx, { cursor: null, since: null, now: new Date() });
      return { ok: true, code: null, message: null };
    } catch (e) {
      if (e instanceof ConnectorError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  }
}
