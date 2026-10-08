import { Injectable, Logger } from '@nestjs/common';
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  type AgentsFactory,
  type BuiltInAgentClassicConfig,
  type CopilotRuntimeFetchHandler,
} from '@copilotkit/runtime/v2';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { createOpenAI } from '@ai-sdk/openai';
import type { ReportScope } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { ReportAiService, type RunPlan } from './report-ai.service';
import { buildSystemPrompt } from './report-prompt';
import { StatelessAgentRunner } from './report-runner';
import {
  OPENROUTER_BASE_URL,
  REPORT_AGENT_ID,
  matchRuntimeRoute,
  windowFromBody,
} from './report-rules';
import { runScope, type RunScope } from './report-run-scope';
import { ReportToolsFactory } from './report-tools';

/** The base path the runtime strips; the Nest route prefix is removed before the request reaches it. */
const BASE = '/runtime';
/** How many tool-calling turns one answer may take (list, read each document, three number tools, render). */
const MAX_STEPS = 16;

// The runtime reports usage events to the vendor's telemetry service unless told not to. This is a customer-data product: it never does.
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true';

/**
 * Mounts the CopilotKit runtime behind Nest routes, so every global guard (sign-in, account gate, trial gate, permissions, plan gate, the
 * operator guard) and the request context (tenant, user, row-level security) apply before the runtime sees a byte.
 *
 * The runtime is a fetch handler: it takes a Web `Request` and answers a Web `Response`. This service builds the Request from the Express
 * request (headers reduced to the few the protocol needs; the body from the bytes the body parser already read), hands it over, and streams
 * the Response back. Two runtimes exist, one per screen, each with its own agent factory:
 *
 *  - the AGENT is built per request. The factory runs inside the caller's request context and `runScope`, so it reads that caller's key
 *    plan and tools; for any route but `run` it returns an inert agent that cannot reach a model.
 *  - the KEY is decided before the runtime is called, for a run only, so "no AI key" is a normal 422 problem the web can show, not an
 *    error frame inside an event stream.
 *  - the RUNNER keeps no history (see StatelessAgentRunner).
 *
 * Only `info`, `run`, `connect` and `stop` are reachable (matchRuntimeRoute); every other runtime route is a 404 here.
 */
@Injectable()
export class ReportRuntimeService {
  private readonly logger = new Logger(ReportRuntimeService.name);
  private readonly runner = new StatelessAgentRunner();
  private readonly handlers = new Map<ReportScope, CopilotRuntimeFetchHandler>();

  /**
   * The model the agent is given for a run: the `provider/model` string, which the runtime turns into a vendor client with the key
   * passed alongside. A test seam: the end-to-end suite replaces it with a scripted model so the whole path runs without a vendor.
   */
  modelFor: (plan: RunPlan) => BuiltInAgentClassicConfig['model'] = (plan) =>
    plan.provider === 'openrouter'
      ? // OpenRouter speaks OpenAI's chat-completions API at its own address; the key is the person's own, passed explicitly.
        createOpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey: plan.apiKey }).chat(plan.model)
      : plan.spec;

  constructor(
    private readonly ai: ReportAiService,
    private readonly tools: ReportToolsFactory,
  ) {}

  /** Answers one runtime request of `scope`. `rest` is the part of the path after `/runtime`. */
  async handle(
    scope: ReportScope,
    req: ExpressRequest,
    res: ExpressResponse,
    rest: string,
  ): Promise<void> {
    const route = matchRuntimeRoute(req.method, rest);
    if (!route) throw AppError.notFound('Route');

    const ctx = RequestContextStore.require();
    // The key is decided here, before the runtime is involved: a refusal is a problem+json answer with a status code.
    const plan = route === 'run' ? await this.ai.resolve(scope) : undefined;
    const store: RunScope = {
      scope,
      ctx,
      plan,
      window:
        route === 'run'
          ? windowFromBody((req as ExpressRequest & { rawBody?: Buffer }).rawBody)
          : undefined,
      tenantKey: scope === 'workspace' ? `w${ctx.orgId}:${ctx.userId}` : `p${ctx.actorId}`,
      onUsage: (usage) => (plan ? this.ai.record(plan, usage) : Promise.resolve()),
    };

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const response = await runScope.run(store, () =>
      this.handler(scope)(this.toWebRequest(req, rest, abort.signal)),
    );
    await this.send(response, res);
  }

  // --- the runtime -------------------------------------------------------------------------------------------------------------------------

  private handler(scope: ReportScope): CopilotRuntimeFetchHandler {
    let handler = this.handlers.get(scope);
    if (!handler) {
      const agents: AgentsFactory = () => ({ [REPORT_AGENT_ID]: this.agentFor(scope) });
      handler = createCopilotRuntimeHandler({
        runtime: new CopilotRuntime({
          agents,
          runner: this.runner,
          // Open Generative UI: the browser registers the `generateSandboxedUi` tool when /info says this is on, and the runtime
          // turns that tool's streamed call into `open-generative-ui` activity events the page draws in a sandboxed iframe.
          // The middleware is applied to the per-request agent clone; it adds no server-side tool.
          openGenerativeUI: true,
        }),
        basePath: BASE,
        mode: 'multi-route',
      });
      this.handlers.set(scope, handler);
    }
    return handler;
  }

  /** The agent of the request being served: real for a run, inert for everything else. */
  private agentFor(scope: ReportScope): BuiltInAgent {
    const store = runScope.getStore();
    if (!store?.plan) {
      return new BuiltInAgent({
        type: 'custom',
        // Reached only if a route other than `run` somehow starts a run: it ends at once and never calls a model.
        // eslint-disable-next-line require-yield
        factory: async function* () {
          throw new Error('The report assistant is not ready.');
        },
      });
    }
    const { plan, ctx } = store;
    return new BuiltInAgent({
      // `spec` + the explicit key: the runtime falls back to a server environment variable only when no key is passed.
      model: this.modelFor(plan),
      apiKey: plan.apiKey,
      maxSteps: MAX_STEPS,
      maxOutputTokens: plan.maxOutputTokens,
      prompt: buildSystemPrompt(scope, new Date(), store.window),
      tools: this.tools.build(scope, ctx, store.window),
    });
  }

  // --- Express <-> fetch -------------------------------------------------------------------------------------------------------------------

  /**
   * The Web Request the runtime reads. Only the headers the protocol uses are copied (never the bearer token or the cookies), and the
   * body is the bytes the body parser already read: the stream itself is spent by then.
   */
  private toWebRequest(req: ExpressRequest, rest: string, signal: AbortSignal): Request {
    const headers = new Headers();
    for (const name of ['content-type', 'accept']) {
      const v = req.header(name);
      if (v) headers.set(name, v);
    }
    const raw = (req as ExpressRequest & { rawBody?: Buffer }).rawBody;
    const body =
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : (raw ?? (req.body === undefined ? undefined : Buffer.from(JSON.stringify(req.body))));
    return new Request(`http://report-copilot.internal${BASE}${rest}`, {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal,
    });
  }

  /** Copies the runtime's Response to Express, streaming (the run is a Server-Sent Events stream). */
  private async send(response: Response, res: ExpressResponse): Promise<void> {
    res.status(response.status);
    for (const [name, value] of response.headers) {
      const lower = name.toLowerCase();
      // Framing and CORS are the server's: Nest's CORS policy for this app already ran.
      if (
        lower === 'content-length' ||
        lower === 'transfer-encoding' ||
        lower.startsWith('access-control-')
      )
        continue;
      res.setHeader(name, value);
    }
    res.setHeader('X-Accel-Buffering', 'no');
    if (!response.body) {
      res.end();
      return;
    }
    const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    stream.on('error', (err) => {
      this.logger.warn({ err: String(err) }, 'the report assistant stream broke');
      res.destroy();
    });
    res.on('close', () => stream.destroy());
    res.flushHeaders();
    stream.pipe(res);
  }
}
