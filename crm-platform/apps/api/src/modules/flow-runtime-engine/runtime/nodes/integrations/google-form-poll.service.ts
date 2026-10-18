import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../../infra/db/database.service';
import {
  GOOGLE_WORKSPACE,
  GoogleAccountError,
  type FormResponseItem,
  type GoogleWorkspacePort,
} from '../../../../../infra/providers/flow-runtime-engine/google-workspace.port';
import { REDIS_CLIENT } from '../../../../../infra/redis/redis.module';
import { FlowEngine } from '../../engine.service';
import { GOOGLE_FORM_HANDLER } from './google-nodes';

/** Runs waiting on a form that one poll looks at; a busier backlog is served over the next polls. */
const WAITING_MAX = 500;
/** A submission made this long before the wait began still counts (the link is sent a moment before the run parks). */
const CLOCK_SLACK_MS = 30_000;
/** How long a delivered submission is remembered, so the next poll does not hand it to another waiting run. */
const CLAIM_TTL_SECONDS = 14 * 86_400;

interface WaitingRun {
  orgId: number;
  runId: number;
  formId: string;
  waitingSince: Date;
}

/**
 * The submission side of the Google Form node (TW-FLR-046). Reference had the customer paste an Apps Script into the form; here the
 * workspace's connected Google account reads the form's responses instead, so nothing is pasted anywhere. Once a poll, every
 * workspace that has a run waiting on a form: the newest run waiting on the form that began waiting before the submission resumes with
 * the answers (the same rule as the old webhook). A submission is handed out once: it is claimed in Redis by form and response id
 * before it is delivered, and a run that already moved on cannot be answered twice (`deliverExternal` refuses it).
 *
 * A workspace whose Google account cannot read the form (not connected, needs reconnecting, permission missing) is skipped quietly:
 * the run keeps waiting and leaves by its timeout port, and the Google account page shows what is wrong.
 *
 * Worker only. Runs privileged to find waiting runs across workspaces; every delivery then runs in that workspace.
 */
@Injectable()
export class GoogleFormPollService {
  private readonly logger = new Logger(GoogleFormPollService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly engine: FlowEngine,
    @Inject(GOOGLE_WORKSPACE) private readonly google: GoogleWorkspacePort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Interval(30_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tickOnce();
    } catch (err) {
      this.logger.error({ err }, '[FLR] google form poll failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. Returns how many waiting runs were resumed. */
  async tickOnce(): Promise<number> {
    const waiting = await this.waitingRuns();
    const byForm = new Map<string, WaitingRun[]>();
    for (const w of waiting) {
      const key = `${w.orgId}:${w.formId}`;
      byForm.set(key, [...(byForm.get(key) ?? []), w]);
    }
    let resumed = 0;
    for (const runs of byForm.values()) resumed += await this.pollForm(runs);
    return resumed;
  }

  private async waitingRuns(): Promise<WaitingRun[]> {
    const res = await this.db.privileged((tx) =>
      tx.execute(sql`
        SELECT org_id, id, wait->'data'->>'formId' AS form_id, last_activity_at
          FROM flow_runs
         WHERE status = 'waiting' AND wait->>'handler' = ${GOOGLE_FORM_HANDLER}
           AND wait->'data'->>'formId' IS NOT NULL
         ORDER BY id LIMIT ${WAITING_MAX}`),
    );
    return (
      res.rows as Array<{
        org_id: string | number;
        id: string | number;
        form_id: string;
        last_activity_at: Date | string;
      }>
    ).map((r) => ({
      orgId: Number(r.org_id),
      runId: Number(r.id),
      formId: r.form_id,
      waitingSince: new Date(r.last_activity_at),
    }));
  }

  /** The runs of one workspace waiting on one form, oldest first. */
  private async pollForm(runs: WaitingRun[]): Promise<number> {
    const { orgId, formId } = runs[0]!;
    const since = new Date(Math.min(...runs.map((r) => r.waitingSince.getTime())) - CLOCK_SLACK_MS);
    let responses: FormResponseItem[];
    try {
      responses = await this.google.formResponses(orgId, formId, since);
    } catch (err) {
      if (!(err instanceof GoogleAccountError)) this.logger.warn({ err, orgId }, '[FLR] form read');
      return 0;
    }
    let left = [...runs];
    let resumed = 0;
    for (const response of responses) {
      const limit = response.submittedAt.getTime() + CLOCK_SLACK_MS;
      const target = [...left].reverse().find((r) => r.waitingSince.getTime() <= limit);
      if (!target) continue;
      const claimed = await this.redis
        .set(
          `flr:gform:${orgId}:${formId}:${response.responseId}`,
          '1',
          'EX',
          CLAIM_TTL_SECONDS,
          'NX',
        )
        .catch(() => 'OK');
      if (claimed === null) continue;
      const result = await this.engine.deliverExternal(orgId, target.runId, GOOGLE_FORM_HANDLER, {
        answers: response.answers,
        responseId: response.responseId,
        respondent: response.respondent,
      });
      // Resumed, or already moved on: either way this run takes no further submission.
      left = left.filter((r) => r.runId !== target.runId);
      if (result !== 'not_waiting') resumed++;
    }
    return resumed;
  }
}
