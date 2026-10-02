import {
  boardResponseSchema,
  boardStagePageResponseSchema,
  dealActivityPageResponseSchema,
  dealActivityResponseSchema,
  dealReportsResponseSchema,
  dealResponseSchema,
  dealSettingsResponseSchema,
  lostReasonResponseSchema,
  pageResponseSchema,
  pipelineResponseSchema,
  pipelineStageResponseSchema,
} from '@crm/contracts';
import { z } from 'zod';
import { call } from './http';
import {
  mapActivity,
  mapBoard,
  mapDeal,
  mapLostReason,
  mapPipeline,
  mapReport,
  mapSettings,
  mapStage,
} from './mappers';
import {
  contactHitPageSchema,
  memberPageSchema,
  type Activity,
  type Board,
  type ContactHit,
  type CreateDealInput,
  type Deal,
  type DealSettings,
  type LostReason,
  type Member,
  type MoveDealInput,
  type Pipeline,
  type Report,
  type Stage,
  type StageInput,
  type UpdateDealInput,
} from './schemas';

type Query = Record<string, string | number | boolean | undefined>;

export interface DealPageResult {
  deals: Deal[];
  nextCursor: string | null;
  hasMore: boolean;
}

const dealPage = pageResponseSchema(dealResponseSchema);

/** Every deals call, one function each. Reads are parsed with the shared contracts, then mapped to the view models. */
export const dealsApi = {
  // pipelines and stages
  async pipelines(signal?: AbortSignal): Promise<Pipeline[]> {
    const rows = await call('/pipelines', { schema: z.array(pipelineResponseSchema), signal });
    return rows.map(mapPipeline);
  },
  async createPipeline(input: { name: string; currency: string }): Promise<Pipeline> {
    return mapPipeline(
      await call('/pipelines', { method: 'POST', body: input, schema: pipelineResponseSchema }),
    );
  },
  async updatePipeline(
    p: Pick<Pipeline, 'id' | 'rowVersion'>,
    input: { name?: string; currency?: string; isDefault?: true },
  ): Promise<Pipeline> {
    return mapPipeline(
      await call(`/pipelines/${p.id}`, {
        method: 'PATCH',
        body: { ...input, rowVersion: p.rowVersion },
        schema: pipelineResponseSchema,
      }),
    );
  },
  /** A pipeline that holds deals needs the pipeline they move to. */
  deletePipeline: (id: string, moveDealsToPipelineId?: string): Promise<void> =>
    call(`/pipelines/${id}`, { method: 'DELETE', query: { moveDealsToPipelineId } }),
  async createStage(pipelineId: string, input: StageInput): Promise<Stage> {
    return mapStage(
      await call(`/pipelines/${pipelineId}/stages`, {
        method: 'POST',
        body: input,
        schema: pipelineStageResponseSchema,
      }),
    );
  },
  async updateStage(s: Pick<Stage, 'id' | 'rowVersion'>, input: Partial<StageInput>): Promise<Stage> {
    return mapStage(
      await call(`/pipeline-stages/${s.id}`, {
        method: 'PATCH',
        body: { ...input, rowVersion: s.rowVersion },
        schema: pipelineStageResponseSchema,
      }),
    );
  },
  deleteStage: (id: string, moveDealsToStageId?: string): Promise<void> =>
    call(`/pipeline-stages/${id}`, { method: 'DELETE', query: { moveDealsToStageId } }),
  async reorderStages(pipelineId: string, stageIds: string[]): Promise<Pipeline> {
    return mapPipeline(
      await call(`/pipelines/${pipelineId}/stages/order`, {
        method: 'PUT',
        body: { stageIds },
        schema: pipelineResponseSchema,
      }),
    );
  },

  // board and list
  /** The whole board: every column's first page, the totals (converted to the pipeline currency) and the KPIs. */
  async board(
    pipelineId: string,
    currency: string,
    query: Query,
    signal?: AbortSignal,
    limit = 25,
  ): Promise<Board> {
    const res = await call('/deals/board', {
      query: { ...query, pipelineId, limit, convertTo: currency },
      schema: boardResponseSchema,
      signal,
    });
    return mapBoard(res);
  },
  async stagePage(
    stageId: string,
    currency: string,
    query: Query,
    cursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<DealPageResult> {
    const res = await call(`/deals/board/stages/${stageId}/deals`, {
      query: { ...query, limit: 25, cursor },
      schema: boardStagePageResponseSchema,
      signal,
    });
    return {
      deals: res.data.map((d) => mapDeal(d, currency)),
      nextCursor: res.page.nextCursor,
      hasMore: res.page.hasMore,
    };
  },
  async deals(query: Query, signal?: AbortSignal): Promise<DealPageResult> {
    const res = await call('/deals', { query, schema: dealPage, signal });
    return {
      deals: res.data.map((d) => mapDeal(d)),
      nextCursor: res.page.nextCursor,
      hasMore: res.page.hasMore,
    };
  },

  // one deal
  async deal(id: string, currency?: string, signal?: AbortSignal): Promise<Deal> {
    return mapDeal(await call(`/deals/${id}`, { schema: dealResponseSchema, signal }), currency);
  },
  async createDeal(input: CreateDealInput, currency?: string): Promise<Deal> {
    return mapDeal(
      await call('/deals', { method: 'POST', body: input, schema: dealResponseSchema }),
      currency,
    );
  },
  async updateDeal(
    deal: Pick<Deal, 'id' | 'rowVersion'>,
    input: UpdateDealInput,
    currency?: string,
  ): Promise<Deal> {
    return mapDeal(
      await call(`/deals/${deal.id}`, {
        method: 'PATCH',
        body: { ...input, rowVersion: deal.rowVersion },
        schema: dealResponseSchema,
      }),
      currency,
    );
  },
  /** Moves between stages and inside a column. The API takes one neighbour: the one below the drop wins. */
  async moveDeal(id: string, input: MoveDealInput, currency?: string): Promise<Deal> {
    const { afterDealId, beforeDealId, ...rest } = input;
    const body = beforeDealId
      ? { ...rest, beforeDealId }
      : afterDealId
        ? { ...rest, afterDealId }
        : rest;
    return mapDeal(
      await call(`/deals/${id}/stage`, { method: 'PATCH', body, schema: dealResponseSchema }),
      currency,
    );
  },
  deleteDeal: (id: string): Promise<void> => call(`/deals/${id}`, { method: 'DELETE' }),

  // timeline and tasks
  async activities(dealId: string, signal?: AbortSignal): Promise<Activity[]> {
    const page = await call(`/deals/${dealId}/activities`, {
      query: { limit: 100 },
      schema: dealActivityPageResponseSchema,
      signal,
    });
    return page.data.map(mapActivity);
  },
  async addActivity(
    dealId: string,
    input: { type: 'note' | 'call' | 'task'; body: string; dueAt?: string },
  ): Promise<Activity> {
    return mapActivity(
      await call(`/deals/${dealId}/activities`, {
        method: 'POST',
        body: input,
        schema: dealActivityResponseSchema,
      }),
    );
  },
  async setTaskDone(dealId: string, activityId: string, done: boolean): Promise<Activity> {
    return mapActivity(
      await call(
        `/deals/${dealId}/activities/${activityId}/${done ? 'complete' : 'reopen'}`,
        { method: 'POST', schema: dealActivityResponseSchema },
      ),
    );
  },

  // reports
  async report(query: Query, currency: string, signal?: AbortSignal): Promise<Report> {
    const res = await call('/deals/reports', {
      query: { ...query, convertTo: currency },
      schema: dealReportsResponseSchema,
      signal,
    });
    return mapReport(res, currency);
  },

  // lost reasons and settings
  async lostReasons(activeOnly: boolean, signal?: AbortSignal): Promise<LostReason[]> {
    const rows = await call('/deal-lost-reasons', {
      query: { activeOnly: activeOnly ? 'true' : undefined },
      schema: z.array(lostReasonResponseSchema),
      signal,
    });
    return rows.map(mapLostReason);
  },
  async createLostReason(name: string): Promise<LostReason> {
    return mapLostReason(
      await call('/deal-lost-reasons', { method: 'POST', body: { name }, schema: lostReasonResponseSchema }),
    );
  },
  async updateLostReason(
    r: Pick<LostReason, 'id' | 'rowVersion'>,
    input: { name?: string; isActive?: boolean },
  ): Promise<LostReason> {
    return mapLostReason(
      await call(`/deal-lost-reasons/${r.id}`, {
        method: 'PATCH',
        body: { ...input, rowVersion: r.rowVersion },
        schema: lostReasonResponseSchema,
      }),
    );
  },
  deleteLostReason: (id: string): Promise<void> => call(`/deal-lost-reasons/${id}`, { method: 'DELETE' }),
  async reorderLostReasons(reasonIds: string[]): Promise<LostReason[]> {
    const rows = await call('/deal-lost-reasons/order', {
      method: 'PUT',
      body: { reasonIds },
      schema: z.array(lostReasonResponseSchema),
    });
    return rows.map(mapLostReason);
  },
  async settings(signal?: AbortSignal): Promise<DealSettings> {
    return mapSettings(await call('/deal-settings', { schema: dealSettingsResponseSchema, signal }));
  },
  async saveSettings(lostReasonRequired: boolean): Promise<DealSettings> {
    return mapSettings(
      await call('/deal-settings', {
        method: 'PUT',
        body: { lostReasonRequired },
        schema: dealSettingsResponseSchema,
      }),
    );
  },

  // pickers
  async members(signal?: AbortSignal): Promise<Member[]> {
    const page = await call('/users', { query: { limit: 200 }, schema: memberPageSchema, signal });
    return page.data;
  },
  async searchContacts(q: string, signal?: AbortSignal): Promise<ContactHit[]> {
    const page = await call('/contacts', {
      query: { q: q.trim() || undefined, limit: 15 },
      schema: contactHitPageSchema,
      signal,
    });
    return page.data;
  },
};
