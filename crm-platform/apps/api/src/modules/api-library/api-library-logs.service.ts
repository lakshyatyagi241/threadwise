import { Injectable, Logger } from '@nestjs/common';
import type {
  ApiLibraryLogApisResponse,
  ApiLibraryLogDetail,
  ExportApiLibraryLogsQuery,
  ListApiLibraryLogsQuery,
  ListApiLibraryLogsResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { buildCsv } from '../../common/csv';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { numberedPage, toLogDetail, toLogItem } from './api-library.mapper';
import { logFilterApis, logResponseText, maskJsonText, truncateText } from './api-library.rules';
import { ApiLibraryRepository } from './api-library.repository';
import { ApiLibraryLogsRepository, type NewLog } from './api-library-logs.repository';
import { LOG_BODY_LIMIT, type RunOutcome } from './api-library-runner.service';

/** The most runs one log export file holds. */
export const LOG_EXPORT_MAX_ROWS = 5000;

/** Where a run came from, for the log. */
export interface RunContext {
  source: NewLog['source'];
  apiUuid: string | null;
  apiName: string;
  userId?: number | null;
  contactUuid?: string | null;
  flowId?: number | null;
  flowRunUuid?: string | null;
  flowNodeId?: string | null;
}

/** The run log: what the Logs drawer lists, and the writer both a test and a flow node use. */
@Injectable()
export class ApiLibraryLogsService {
  private readonly logger = new Logger(ApiLibraryLogsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ApiLibraryLogsRepository,
    private readonly apis: ApiLibraryRepository,
  ) {}

  async list(
    query: ListApiLibraryLogsQuery,
    onlyApi?: string,
  ): Promise<ListApiLibraryLogsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      // A deleted API keeps its runs, so its log stays readable; an id with neither an API nor a run is not found.
      if (
        onlyApi &&
        !(await this.apis.findByUuid(tx, ctx.orgId, onlyApi)) &&
        !(await this.repo.hasRunsOf(tx, ctx.orgId, onlyApi))
      )
        throw AppError.notFound('API', onlyApi);
      const filter = {
        apiUuid: onlyApi ?? query.apiId,
        status: query.status,
        statusCode: query.statusCode,
        source: query.source,
        from: query.from,
        to: query.to,
        search: query.search || undefined,
        bot: query.bot || undefined,
        limit: query.limit,
        order: query.order,
      };
      if (query.page !== undefined) {
        const paged = { ...filter, offset: (query.page - 1) * query.limit };
        const rows = await this.repo.list(tx, ctx.orgId, paged);
        const total = await this.repo.countMatching(tx, ctx.orgId, paged);
        return numberedPage(rows.map(toLogItem), total, query.page, query.limit);
      }
      const rows = await this.repo.list(tx, ctx.orgId, { ...filter, cursor: query.cursor });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toLogItem), page };
    });
  }

  /**
   * The run log as CSV, with the list's filters: the newest runs first, at most LOG_EXPORT_MAX_ROWS of them. Cells are escaped by
   * `csvCell`, so a run's error text cannot start a formula in the spreadsheet it is opened in.
   */
  async exportCsv(query: ExportApiLibraryLogsQuery): Promise<string> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        apiUuid: query.apiId,
        status: query.status,
        statusCode: query.statusCode,
        source: query.source,
        from: query.from,
        to: query.to,
        search: query.search || undefined,
        bot: query.bot || undefined,
        limit: LOG_EXPORT_MAX_ROWS,
        order: 'desc',
      });
      return buildCsv(
        [
          'Time (UTC)',
          'API',
          'Bot',
          'Bot state',
          'Source',
          'Method',
          'URL',
          'Result',
          'Status code',
          'Duration (ms)',
          'Error',
        ],
        rows.map((row) => {
          const item = toLogItem(row);
          return [
            item.createdAt,
            item.apiName,
            item.botName,
            item.botState,
            item.source,
            item.method,
            item.url,
            item.ok ? 'success' : 'failed',
            item.statusCode,
            item.durationMs,
            item.error,
          ];
        }),
      );
    });
  }

  /**
   * The APIs the logs' filter offers: every saved API, and each deleted API that still has runs in the window, so its name stays
   * findable after the delete. Only the logs list them; the pickers' feed (apis/options) keeps saved APIs alone.
   */
  async filterApis(): Promise<ApiLibraryLogApisResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const live = await this.apis.all(tx, ctx.orgId);
      const logged = await this.repo.loggedApis(tx, ctx.orgId);
      return { data: logFilterApis(live, logged) };
    });
  }

  async get(uuid: string): Promise<ApiLibraryLogDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Log entry', uuid);
      return toLogDetail(row);
    });
  }

  /**
   * Writes one run into the log on the transaction given. The outcome already carries the masked request; the response body is cut
   * to LOG_BODY_LIMIT here, and a binary answer is logged as a note (see logResponseText). A failed write is a warning and not the
   * run's failure: the call already happened.
   */
  async record(
    tx: Tx,
    orgId: number,
    run: RunContext,
    outcome: RunOutcome,
  ): Promise<string | null> {
    try {
      // A JSON answer is stored with its secret-looking keys masked (a token in the answer must not outlive the run in a log).
      const body = outcome.response
        ? truncateText(maskJsonText(logResponseText(outcome.response)), LOG_BODY_LIMIT)
        : null;
      return await this.repo.insert(tx, orgId, {
        apiUuid: run.apiUuid,
        apiName: run.apiName,
        source: run.source,
        method: outcome.request?.method ?? '',
        url: outcome.request?.url ?? '',
        requestHeaders: outcome.request?.headers ?? {},
        requestBody: outcome.request?.body ?? null,
        statusCode: outcome.status,
        ok: outcome.ok,
        durationMs: outcome.durationMs,
        errorKind: outcome.errorKind,
        error: outcome.error,
        responseHeaders: outcome.response?.headers ?? {},
        responseBody: body?.text ?? null,
        responseTruncated: (body?.truncated ?? false) || (outcome.response?.truncated ?? false),
        userId: run.userId ?? null,
        contactUuid: run.contactUuid ?? null,
        flowId: run.flowId ?? null,
        flowRunUuid: run.flowRunUuid ?? null,
        flowNodeId: run.flowNodeId ?? null,
      });
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'api library log write failed');
      return null;
    }
  }
}
