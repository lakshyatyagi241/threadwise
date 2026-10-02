import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Readable } from 'node:stream';
import { schema } from '@crm/db';
import {
  SEGMENT_INLINE_ACTION_MAX,
  type AddSegmentToGroupInput,
  type ExportSegmentInput,
  type RecordScope,
  type SegmentActionResponse,
  type TagSegmentInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { QUEUES } from '../../../infra/queue/queues';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { ContactBulkRepository } from '../contact-bulk/contact-bulk.repository';
import { ContactBulkService } from '../contact-bulk/contact-bulk.service';
import { ContactGroupsRepository } from '../contact-groups/contact-groups.repository';
import { contactScopeCondition, whereOf } from '../contacts/contact-conditions';
import { countWithTimeout, segmentContactsWhere } from './segment-count';
import { canSee, currentSegmentAccess } from './segment-filter';
import { SegmentsRepository, type SegmentRow } from './segments.repository';
import { SegmentsService } from './segments.service';

const { contacts } = schema;

/** Contacts written per transaction by the group job. */
export const SEGMENT_JOB_CHUNK = 1000;

export interface SegmentAddToGroupJob {
  orgId: number;
  userId: number | null;
  segmentUuid: string;
  groupUuid: string;
  /** The caller's contacts.update scope: the job copies only contacts they could have changed. */
  scope: RecordScope;
  requestId: string | null;
}

/**
 * What a segment can do to its members: export them, tag them, put them in a group. Each is the
 * contacts bulk action run over "the contacts matching this segment" (`filter.segmentId`), so a
 * segment's tag/export/group behave exactly like the same action on a filtered list: record scope,
 * plan limits, audit and outbox included.
 *
 * Tag and group are snapshots: they act on the members at that moment and do not keep following
 * the rule (a contact that joins later is not tagged). Past SEGMENT_INLINE_ACTION_MAX members, the
 * group copy is a background job in chunks (a huge set must not hold one transaction open), so the
 * response says `queued`.
 */
@Injectable()
export class SegmentActionsService {
  private readonly logger = new Logger(SegmentActionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SegmentsRepository,
    private readonly segments: SegmentsService,
    private readonly bulk: ContactBulkService,
    private readonly bulkRepo: ContactBulkRepository,
    private readonly groupsRepo: ContactGroupsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @InjectQueue(QUEUES.SEGMENT_ACTIONS) private readonly queue: Queue<SegmentAddToGroupJob>,
  ) {}

  /** The segment, or 404 when the caller may not see it. */
  private async requireVisible(uuid: string): Promise<SegmentRow> {
    const ctx = RequestContextStore.require();
    const access = currentSegmentAccess();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row || !canSee(row, access)) throw AppError.notFound('Segment', uuid);
      return row;
    });
  }

  private filter(uuid: string) {
    return { includeArchived: false, tagMode: 'any' as const, segmentId: uuid };
  }

  async export(
    uuid: string,
    input: ExportSegmentInput,
    scope: RecordScope,
  ): Promise<{ stream: Readable; fileName: string }> {
    const row = await this.requireVisible(uuid);
    const { stream } = await this.bulk.export({ filter: this.filter(uuid), bom: input.bom }, scope);
    const slug = row.name
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return { stream, fileName: `segment-${slug || 'export'}.csv` };
  }

  async tag(
    uuid: string,
    input: TagSegmentInput,
    scope: RecordScope,
  ): Promise<SegmentActionResponse> {
    await this.requireVisible(uuid);
    const r = await this.bulk.tag(
      { filter: this.filter(uuid), action: 'add', tagId: input.tagId, name: input.name },
      scope,
    );
    return { matched: r.matched, changed: r.changed, queued: false };
  }

  async addToGroup(
    uuid: string,
    input: AddSegmentToGroupInput,
    scope: RecordScope,
  ): Promise<SegmentActionResponse> {
    const ctx = RequestContextStore.require();
    const row = await this.requireVisible(uuid);

    const size = await this.db.tx(async (tx) => {
      const group = await this.groupsRepo.findByUuid(tx, ctx.orgId, input.groupId);
      if (!group) throw AppError.notFound('Contact group', input.groupId);
      const compiled = await this.segments.compile(tx, ctx.orgId, row);
      return countWithTimeout(
        tx,
        segmentContactsWhere(
          ctx.orgId,
          compiled.where,
          contactScopeCondition(ctx.orgId, scope, ctx.userId),
        ),
      );
    });

    // An approximate count means the set is too big to count in time: that is a job's work.
    if (size.approximate || size.count > SEGMENT_INLINE_ACTION_MAX) {
      await this.queue.add(
        'add-to-group',
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          segmentUuid: uuid,
          groupUuid: input.groupId,
          scope,
          requestId: ctx.requestId,
        },
        // One run per (segment, group): a double click is one job, and the work is idempotent anyway.
        {
          jobId: `seg-group-${ctx.orgId}-${uuid}-${input.groupId}-${Math.floor(Date.now() / 60_000)}`,
        },
      );
      return { matched: size.count, changed: 0, queued: true };
    }

    const r = await this.bulk.group(
      { filter: this.filter(uuid), groupId: input.groupId, action: 'add' },
      scope,
    );
    return { matched: r.matched, changed: r.changed, queued: false };
  }

  /**
   * The body of the add-to-group job: members in chunks of SEGMENT_JOB_CHUNK by contact id, each
   * chunk its own transaction (so progress is kept and nothing stays locked), ON CONFLICT DO NOTHING
   * so a retry or a second run changes nothing twice. Runs inside the context the processor built.
   */
  async runAddToGroup(job: SegmentAddToGroupJob): Promise<{ matched: number; changed: number }> {
    const ctx = RequestContextStore.require();
    const meta = { actorId: ctx.actorId, actorType: ctx.actorType, requestId: ctx.requestId };

    const group = await this.db.tx((tx) =>
      this.groupsRepo.findByUuid(tx, job.orgId, job.groupUuid),
    );
    if (!group) return { matched: 0, changed: 0 };

    let after = 0;
    let matched = 0;
    let changed = 0;
    for (;;) {
      const chunk = await this.db.tx(async (tx) => {
        const row = await this.repo.findByUuid(tx, job.orgId, job.segmentUuid);
        if (!row) return null; // deleted while the job waited: nothing left to copy
        const compiled = await this.segments.compile(tx, job.orgId, row);
        const where = segmentContactsWhere(
          job.orgId,
          compiled.where,
          contactScopeCondition(job.orgId, job.scope, job.userId),
        );
        const res = await tx.execute(sql`
          SELECT contacts.id FROM contacts
          WHERE ${where} AND contacts.id > ${after}::bigint
          ORDER BY contacts.id LIMIT ${SEGMENT_JOB_CHUNK}
        `);
        const ids = (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
        if (ids.length === 0) return { ids, added: 0 };
        const added = await this.bulkRepo.addToGroup(
          tx,
          job.orgId,
          whereOf([eq(contacts.orgId, job.orgId), inArray(contacts.id, ids)]),
          { id: group.id, uuid: group.uuid },
          meta,
        );
        return { ids, added };
      });
      if (!chunk || chunk.ids.length === 0) break;
      matched += chunk.ids.length;
      changed += chunk.added;
      after = chunk.ids[chunk.ids.length - 1]!;
      if (chunk.ids.length < SEGMENT_JOB_CHUNK) break;
    }

    // One audit row and one event for the whole run, written in a transaction of their own at the end.
    if (changed > 0) {
      await this.db.tx(async (tx) => {
        await this.audit.record(tx, {
          module: 'contact_groups',
          recordId: group.id,
          action: 'update',
          delta: {
            members: { old: group.memberCount, new: group.memberCount + changed },
            segment: { old: null, new: job.segmentUuid },
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'contact_groups',
          aggregateId: group.id,
          eventType: 'contact_group.members_changed',
          payload: {
            uuid: group.uuid,
            action: 'add',
            changed,
            selection: 'segment',
            segmentId: job.segmentUuid,
          },
        });
      });
    }
    this.logger.log(
      { orgId: job.orgId, segment: job.segmentUuid, matched, changed },
      'segment added to group',
    );
    return { matched, changed };
  }
}
