import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type PageInfo,
  type V1Enroll,
  type V1EnrollResult,
  type V1Flow,
  type V1Subscriber,
  type V1SubscribersQuery,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { AppError } from '../../../../../common/errors/app-error';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { FlowRuntimeService } from '../../../../flow-runtime-engine';
import { v1Error } from '../automation-errors';
import { FlowsV1Repository } from './flows.v1.repository';
import { toPublicEnroll, toPublicFlow, toPublicSubscriber } from './flows.v1.mapper';

const NOT_FOUND = 'Flow not found.';

const flowNotFound = () => new AppError(ERROR_CODES.NOT_FOUND, NOT_FOUND, HttpStatus.NOT_FOUND);

/** Domain errors in Reference's words and codes; anything else passes through. */
function translate(err: unknown): unknown {
  if (!(err instanceof AppError)) return err;
  if (err.code === ERROR_CODES.FLR_FLOW_NOT_FOUND) return flowNotFound();
  if (err.code === ERROR_CODES.FLR_CONTACT_NOT_FOUND)
    return v1Error('contact_not_found', 'Contact not found.', HttpStatus.NOT_FOUND);
  if (err.code === ERROR_CODES.FLR_FLOW_INACTIVE)
    return v1Error('flow_inactive', 'Flow is not active.', HttpStatus.UNPROCESSABLE_ENTITY);
  return err;
}

/**
 * Flows on `/api/v1` (TW-API-044 to 047). Enrolment and the subscriber list are the flow runtime's own (`FlowRuntimeService`, the same
 * door as the dashboard); the list and detail read the flow rows directly because the runtime's REST read lacks `category` and
 * `created_at`.
 */
@Injectable()
export class V1FlowsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FlowsV1Repository,
    private readonly runtime: FlowRuntimeService,
  ) {}

  async list(q: { limit: number; cursor?: string }): Promise<{ items: V1Flow[]; page: PageInfo }> {
    const { orgId } = RequestContextStore.require();
    const cursor = q.cursor ? this.decode(q.cursor) : undefined;
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId, { limit: q.limit, cursor }));
    const page = rows.slice(0, q.limit);
    const hasMore = rows.length > q.limit;
    const last = page[page.length - 1];
    return {
      items: page.map(toPublicFlow),
      page: {
        limit: q.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(`${last.updatedAtIso}|${last.id}`).toString('base64url')
            : null,
      },
    };
  }

  async show(uuid: string): Promise<V1Flow> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row) throw flowNotFound();
    return toPublicFlow(row);
  }

  /**
   * Starts the flow for one contact. A launch that failed (no connected sender, no usable number) still answers 201 with
   * `status: "failed"`, as Reference did, and, unlike Reference, says why in `failure_reason`.
   */
  async enroll(uuid: string, v: V1Enroll): Promise<V1EnrollResult> {
    const { orgId } = RequestContextStore.require();
    let res;
    try {
      res = await this.runtime.enrollOne(uuid, { contactId: v.contact_id, phone: v.phone });
    } catch (err) {
      throw translate(err);
    }
    const reason =
      res.status === 'failed'
        ? await this.db.tx((tx) => this.repo.failureReason(tx, orgId, res.subscriberId))
        : null;
    return toPublicEnroll(res, reason);
  }

  async subscribers(
    uuid: string,
    q: V1SubscribersQuery,
  ): Promise<{ items: V1Subscriber[]; counts: Record<string, number>; page: PageInfo }> {
    if (q.cursor !== undefined && !/^\d{1,18}$/.test(q.cursor))
      throw AppError.validation('Invalid pagination cursor', [
        { path: 'cursor', message: 'Invalid cursor.' },
      ]);
    let res;
    try {
      res = await this.runtime.subscribersOf(uuid, { limit: q.limit, cursor: q.cursor });
    } catch (err) {
      throw translate(err);
    }
    return {
      items: res.items.map(toPublicSubscriber),
      counts: res.counts,
      page: { limit: q.limit, hasMore: res.nextCursor !== null, nextCursor: res.nextCursor },
    };
  }

  private decode(raw: string): { updatedAtIso: string; id: number } {
    try {
      const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
      const n = Number(id);
      if (!iso || !Number.isInteger(n) || Number.isNaN(new Date(iso).getTime())) throw new Error();
      return { updatedAtIso: iso, id: n };
    } catch {
      throw AppError.validation('Invalid pagination cursor', [
        { path: 'cursor', message: 'Invalid cursor.' },
      ]);
    }
  }
}
