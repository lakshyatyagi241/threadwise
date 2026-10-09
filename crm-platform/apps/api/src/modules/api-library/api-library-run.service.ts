import { Injectable } from '@nestjs/common';
import {
  API_LIBRARY_SECRET_MASK,
  apiLibraryIsSensitiveName,
  type ApiLibraryErrorKind,
  type TestApiLibraryApiInput,
  type TestApiLibraryApiResponse,
  type TestApiLibraryFunctionInput,
  type TestApiLibraryFunctionResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { runUserCode } from '../../infra/sandbox/code-sandbox';
import {
  renderBody,
  renderUrl,
  resolveVariables,
  sameOrigin,
  type VariableValues,
} from './api-library.rules';
import { ApiLibraryRepository, type ApiRow } from './api-library.repository';
import { ApiLibraryLogsService, type RunContext } from './api-library-logs.service';
import {
  ApiLibraryRunner,
  FUNCTION_TIMEOUT_MS,
  type RunOutcome,
  type RunnableDefinition,
} from './api-library-runner.service';

/** The test panel returns the parsed answer only up to this size; the text is always there (cut at 64 KB). */
const JSON_RETURN_LIMIT = 256 * 1024;

/** What a flow node learns from a run of a saved API. */
export type FlowApiResult =
  | { found: false }
  | {
      found: true;
      api: {
        id: string;
        name: string;
        mapping: ApiRow['mappingConfig'];
        responseVariables: string[];
        variables: ApiRow['variables'];
      };
      outcome: RunOutcome;
    };

/** Runs a definition on behalf of the Test button and of the flow node. */
@Injectable()
export class ApiLibraryRunService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ApiLibraryRepository,
    private readonly runner: ApiLibraryRunner,
    private readonly logs: ApiLibraryLogsService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * The Test button: runs the definition as the form holds it (not necessarily saved) with the declared defaults, or the values
   * given. The run is logged (source `test`) whatever its outcome. A secret header the form holds as the mask uses the stored value
   * of the API named by `apiId`.
   */
  async test(input: TestApiLibraryApiInput): Promise<TestApiLibraryApiResponse> {
    const ctx = RequestContextStore.require();
    const stored = input.apiId
      ? await this.db.tx(async (tx) => {
          const row = await this.repo.findByUuid(tx, ctx.orgId, input.apiId!);
          if (!row) throw AppError.notFound('API', input.apiId);
          return row;
        })
      : undefined;

    const values = await resolveVariables(input.variables, { overrides: input.values });
    let outcome: RunOutcome;
    const headers: RunnableDefinition['headers'] = [];
    let missing: string | null = null;
    // A stored secret is only ever sent to the address it was saved for: a person who may test but not edit must not be able to
    // aim a saved token at a host of their own by changing the URL in the test form.
    const sameTarget =
      stored !== undefined &&
      sameOrigin(
        renderUrl(input.url, values),
        renderUrl(
          stored.url,
          await resolveVariables(
            stored.variables.map((v) => ({
              name: v.name,
              source: 'flow' as const,
              defaultValue: v.defaultValue,
            })),
            { overrides: input.values },
          ),
        ),
      );
    for (const h of input.headers) {
      const secret = h.secret || apiLibraryIsSensitiveName(h.key);
      if (h.value === API_LIBRARY_SECRET_MASK) {
        const kept = sameTarget
          ? stored?.headers.find((x) => x.secret && x.key.toLowerCase() === h.key.toLowerCase())
          : undefined;
        if (!kept) {
          missing = h.key;
          break;
        }
        headers.push({ key: h.key, value: this.crypto.decrypt(kept.value), secret: true });
      } else headers.push({ key: h.key, value: h.value, secret });
    }
    if (missing !== null) {
      outcome = {
        ok: false,
        status: null,
        durationMs: 0,
        errorKind: 'invalid',
        error: `Enter the value of the header "${missing}" again (a saved secret is only sent to the address it was saved for).`,
        request: null,
        response: null,
        processedPayload: null,
      };
    } else {
      outcome = await this.runner.run(
        {
          method: input.method,
          url: input.url,
          payloadType: input.payloadType,
          headers,
          body: input.body,
          functionCode: input.functionCode,
        },
        values,
      );
    }

    const logId = await this.db.tx((tx) =>
      this.logs.record(
        tx,
        ctx.orgId,
        {
          source: 'test',
          apiUuid: stored?.uuid ?? null,
          apiName: stored?.name ?? input.name ?? '',
          userId: ctx.userId,
        },
        outcome,
      ),
    );
    return toTestResponse(outcome, logId);
  }

  /** The "Run code" button: the function alone, on a sample payload whose variables are replaced by their defaults. */
  async testFunction(input: TestApiLibraryFunctionInput): Promise<TestApiLibraryFunctionResponse> {
    const started = Date.now();
    if (!/\bfunction\s+processPayload\s*\(|\bprocessPayload\s*=/.test(input.functionCode)) {
      return {
        ok: false,
        output: null,
        error: 'The code must define function processPayload(payload).',
        durationMs: 0,
      };
    }
    const values = await resolveVariables(input.variables);
    const payload =
      input.payload !== null && typeof input.payload === 'object'
        ? renderBody(input.payload as Record<string, unknown>, values)
        : input.payload;
    const ran = await runUserCode(
      `${input.functionCode}\nreturn processPayload(functionArgs);`,
      { functionArgs: payload },
      { timeoutMs: FUNCTION_TIMEOUT_MS },
    );
    return {
      ok: ran.ok,
      output: ran.ok ? ran.result : null,
      error: ran.ok ? null : (ran.error ?? 'The function failed.'),
      durationMs: Date.now() - started,
    };
  }

  /**
   * A flow node's run of a saved API, outside any request (a worker): the tenant is named, the API is loaded for that workspace only,
   * the run is logged (source `flow`) and the outcome is returned for the node to apply (variables, contact properties, port).
   * `lookup` answers a variable from the run (its variables, then the contact); `overrides` are the node's own inputs.
   */
  async runForFlow(input: {
    orgId: number;
    apiId: string;
    overrides: Record<string, string>;
    /** The step's stable key (`flow:<run>:<step>:<node>`), sent as `Idempotency-Key` on a request that changes something. */
    idempotencyKey?: string;
    lookup: (name: string) => Promise<string | undefined | null>;
    context: Pick<RunContext, 'contactUuid' | 'flowId' | 'flowRunUuid' | 'flowNodeId'>;
  }): Promise<FlowApiResult> {
    const row = await this.db.txAs({ orgId: input.orgId }, (tx) =>
      this.repo.findByUuid(tx, input.orgId, input.apiId),
    );
    if (!row) return { found: false };
    const values: VariableValues = await resolveVariables(
      row.variables.map((v) => ({
        name: v.name,
        source: 'flow' as const,
        defaultValue: v.defaultValue,
      })),
      { overrides: input.overrides, lookup: input.lookup },
    );
    const outcome = await this.runner.run(
      {
        method: row.method,
        url: row.url,
        payloadType: row.payloadType,
        headers: row.headers.map((h) => ({
          key: h.key,
          value: h.secret ? this.crypto.decrypt(h.value) : h.value,
          secret: h.secret,
        })),
        body: row.body,
        functionCode: row.functionCode,
        idempotencyKey: input.idempotencyKey,
      },
      values,
    );
    await this.db.txAs({ orgId: input.orgId }, (tx) =>
      this.logs.record(
        tx,
        input.orgId,
        { source: 'flow', apiUuid: row.uuid, apiName: row.name, ...input.context },
        outcome,
      ),
    );
    return {
      found: true,
      api: {
        id: row.uuid,
        name: row.name,
        mapping: row.mappingConfig,
        responseVariables: row.responseVariables,
        variables: row.variables,
      },
      outcome,
    };
  }

  /** A flow run that named an API that no longer exists leaves a log line of its own. */
  async recordMissing(input: {
    orgId: number;
    apiId: string;
    context: Pick<RunContext, 'contactUuid' | 'flowId' | 'flowRunUuid' | 'flowNodeId'>;
  }): Promise<void> {
    const outcome: RunOutcome = {
      ok: false,
      status: null,
      durationMs: 0,
      errorKind: 'invalid',
      error: 'The API this step calls no longer exists.',
      request: null,
      response: null,
      processedPayload: null,
    };
    await this.db.txAs({ orgId: input.orgId }, (tx) =>
      this.logs.record(
        tx,
        input.orgId,
        { source: 'flow', apiUuid: input.apiId, apiName: '', ...input.context },
        outcome,
      ),
    );
  }
}

export function toTestResponse(
  outcome: RunOutcome,
  logId: string | null,
): TestApiLibraryApiResponse {
  const response = outcome.response;
  return {
    ok: outcome.ok,
    status: outcome.status,
    durationMs: outcome.durationMs,
    errorKind: outcome.errorKind as ApiLibraryErrorKind | null,
    error: outcome.error,
    request: outcome.request,
    response: response
      ? {
          headers: response.headers,
          contentType: response.contentType,
          bodyText: response.bodyText,
          bodyJson: response.bodyText.length <= JSON_RETURN_LIMIT ? response.bodyJson : null,
          truncated: response.truncated,
          sizeBytes: response.sizeBytes,
        }
      : null,
    processedPayload: outcome.processedPayload,
    logId,
  };
}
