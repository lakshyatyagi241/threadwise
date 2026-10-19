import { Injectable } from '@nestjs/common';
import type {
  DeploymentsQuery,
  DeploymentsResponse,
  PublishesQuery,
  PublishesResponse,
} from '@crm/contracts';
import { DeploymentsStore } from './deployments.store';
import {
  toDeploymentCounts,
  toDeploymentRow,
  toPublishCounts,
  toPublishRow,
} from './deployments.mapper';

/** The operator's view of every Geta publish: what is queued, what runs now, what failed and why. Read-only. */
@Injectable()
export class DeploymentsService {
  constructor(private readonly store: DeploymentsStore) {}

  async list(query: DeploymentsQuery): Promise<DeploymentsResponse> {
    const generatedAt = new Date().toISOString();
    const { rows, counts } = await this.store.list(query.status ?? null, query.limit);
    return {
      generatedAt,
      counts: toDeploymentCounts(counts),
      rows: rows.slice(0, query.limit).map(toDeploymentRow),
      truncated: rows.length > query.limit,
    };
  }

  /** Flow publishes: what the worker has queued, is running, failed on, and finished. Read-only. */
  async publishes(query: PublishesQuery): Promise<PublishesResponse> {
    const generatedAt = new Date().toISOString();
    const { rows, counts } = await this.store.listPublishes(query.status ?? null, query.limit);
    return {
      generatedAt,
      counts: toPublishCounts(counts),
      rows: rows.slice(0, query.limit).map(toPublishRow),
      truncated: rows.length > query.limit,
    };
  }
}
