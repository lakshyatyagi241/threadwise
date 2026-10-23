import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../../../../infra/db/database.service';
import {
  MessageStatusHooks,
  type MessageStatusEvent,
  type MessageStatusListener,
} from '../../../../chat-conversations';
import { FlowEngine } from '../../engine.service';
import { RunRepository } from '../../run.repository';

/** How early a message may be stored before the wait it answers was parked (the send and the park are two steps of one run). */
const SLACK_MS = 10_000;

/**
 * Where the provider's word about a template comes back to the flow: a Template node with status exits waits (`Custom`, handler
 * `Template`) and this listener hands it each delivery step (`delivered`, `read`, `failed`) of a message of THAT template, sent to the
 * customer the run belongs to after the node parked: a receipt for an older message, another template or another customer is never
 * the answer. The node decides whether the author wired an exit for the step. Worker process only.
 */
@Injectable()
export class TemplateStatusResume implements MessageStatusListener, OnModuleInit {
  readonly name = 'flow-template-status';
  private readonly logger = new Logger(TemplateStatusResume.name);

  constructor(
    private readonly hooks: MessageStatusHooks,
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
    private readonly engine: FlowEngine,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onStatus(e: MessageStatusEvent): Promise<void> {
    if ((e.templateId === null && e.templateName === null) || e.status === 'sent') return;
    const run = await this.db.txAs({ orgId: e.orgId }, (tx) =>
      this.runs.liveByPeer(tx, e.orgId, e.channelId, e.peerKey),
    );
    if (!run || run.status !== 'waiting' || run.wait?.handler !== 'Template') return;
    const d = (run.wait.data ?? {}) as {
      templateId?: unknown;
      templateName?: unknown;
      since?: unknown;
    };
    // A flow records the template it sent by name; an inbox send by row: either one ties the receipt to the node's template.
    const same =
      (e.templateName !== null && d.templateName === e.templateName) ||
      (e.templateId !== null && d.templateId === e.templateId);
    if (!same) return;
    const since = typeof d.since === 'string' ? Date.parse(d.since) : NaN;
    if (Number.isFinite(since) && e.messageCreatedAt.getTime() < since - SLACK_MS) return;
    const r = await this.engine.deliverExternal(e.orgId, run.id, 'Template', {
      status: e.status,
    });
    this.logger.log(
      { orgId: e.orgId, runId: run.id, status: e.status, result: r },
      '[FLR] template status',
    );
  }
}
