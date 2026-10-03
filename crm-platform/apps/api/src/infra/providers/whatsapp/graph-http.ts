/**
 * The HTTP seam under the Graph client: one method, plain data in and out, so a test stubs it with a function (or points
 * `GRAPH_API_BASE_URL` at a fake server and keeps the real one). Nothing above it knows about `fetch`.
 *
 * It never retries and never follows a redirect: a retry is the dispatch worker's decision (`ChannelError.retryable`), and a
 * redirect from the Graph API would carry the access token somewhere nobody chose.
 */
export interface GraphRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** `<base url>/<api version>` of the provider this call goes to (`https://graph.facebook.com/v23.0`). */
  root: string;
  /** A path under the root, starting with `/` (`/123456/messages`). */
  path: string;
  query?: Record<string, string | undefined>;
  /** JSON body. */
  body?: unknown;
  /** Every authentication and context header the provider wants (the resolved profile builds them). */
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface GraphResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  /** The parsed JSON, or `null` when the body was empty or not JSON. */
  json: unknown;
  /** The raw text (for an error message built from a non-JSON answer), cut to 64 KB. */
  text: string;
}

/** The connection failed before an answer: refused, reset, DNS, timeout. `timedOut` distinguishes the last. */
export class GraphTransportError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean,
  ) {
    super(message);
    this.name = 'GraphTransportError';
  }
}

export interface GraphHttp {
  request(req: GraphRequest): Promise<GraphResponse>;
}

export const GRAPH_HTTP = Symbol('GRAPH_HTTP');

/** The real thing: global `fetch` with an abort timer. */
export class FetchGraphHttp implements GraphHttp {
  async request(req: GraphRequest): Promise<GraphResponse> {
    const url = new URL(`${req.root}${req.path}`);
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);

    const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
    if (req.body !== undefined) headers['content-type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        redirect: 'manual',
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (err) {
      const e = err as Error;
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      // The URL can carry a query credential: the message never includes it.
      throw new GraphTransportError(
        timedOut
          ? `The Graph API did not answer within ${Math.round(req.timeoutMs / 1000)} s`
          : `Could not reach the Graph API (${(e.cause as { code?: string } | undefined)?.code ?? e.message})`,
        timedOut,
      );
    }

    const text = (await res.text().catch(() => '')).slice(0, 65_536);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k.toLowerCase()] = v;
    });
    return { status: res.status, headers: outHeaders, json, text };
  }
}
