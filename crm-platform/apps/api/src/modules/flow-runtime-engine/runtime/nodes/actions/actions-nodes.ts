import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../../../../chat-conversations';
import { DealsService, TagsService } from '../../../../crm';
import {
  ConversationEventsRepository,
  ConversationsRepository,
} from '../../../../team-inbox-conversations';
import { AssignmentService, HandoffService } from '../../../../team-inbox-routing-sla';
import { HANDOFF_PORTS, HANDOFF_REASONS, conversationPrioritySchema, type HandoffDestination, type HandoffReason } from '@crm/contracts';
import type { NodeContext, NodeExecutor, NodeResult, RunState } from '../../types';
import {
  assignConfig,
  handoffConfig,
  dealConfig,
  instagramMessage,
  notifyPlan,
  tagConfig,
  UUID_RE,
} from './actions-config';
import { NumberSender } from './number-sender.service';
import { haltOf } from '../../halt';

const advance: NodeResult = { kind: 'advance', port: 1 };
const data = (ctx: NodeContext): Record<string, unknown> => {
  const d = ctx.node.props.data;
  return d !== null && typeof d === 'object' ? (d as Record<string, unknown>) : {};
};
const reasonOf = (err: unknown): string =>
  err instanceof Error ? err.message : 'something went wrong';

/**
 * Node group `actions` (TW-FLR-035 to 039): the steps that act on the CRM or on someone other than the flow's customer.
 *
 * Reference's rule for all five is that a step never stops the flow: a bad configuration or a refusal is logged and the flow moves on
 * (the Deal node alone has a second port, `error`). Here the same: the reason goes into the run log (`ctx.note`) and the step
 * leaves by its port. Only a channel that is down halts the run (the Instagram link is a send to the customer).
 */
@Injectable()
export class ActionNodes implements NodeExecutor {
  readonly types: readonly string[] = [
    'TagContact',
    'AssignAgent',
    'Deal',
    'NotifyNumber',
    'WaToInstagram',
  ];
  private readonly logger = new Logger(ActionNodes.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tags: TagsService,
    private readonly deals: DealsService,
    private readonly assignment: AssignmentService,
    private readonly handoff: HandoffService,
    private readonly numbers: NumberSender,
    private readonly conversationsRepo: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    switch (ctx.node.type) {
      case 'TagContact':
        return this.tag(ctx);
      case 'AssignAgent':
        return this.assign(ctx);
      case 'Deal':
        return this.deal(ctx);
      case 'NotifyNumber':
        return this.notify(ctx);
      default:
        return this.instagram(ctx);
    }
  }

  /** TW-FLR-035. Adds or removes a tag on the run's contact. Does NOT start `tag_added` flows (Reference's Tag step never did). */
  private async tag(ctx: NodeContext): Promise<NodeResult> {
    const cfg = tagConfig(data(ctx));
    if (!cfg.tagId && !cfg.name) {
      ctx.note('no tag chosen: skipped');
      return advance;
    }
    const run = ctx.run;
    if (run.contactId === null) {
      ctx.note('this run has no contact to tag: skipped');
      return advance;
    }
    try {
      const done = await this.tags.applyFromFlow(run.orgId, run.contactId, cfg.action, {
        tagId: cfg.tagId,
        name: cfg.name,
      });
      ctx.note(
        `tag "${done.tagName}" ${cfg.action === 'add' ? 'added' : 'removed'}${done.changed ? '' : ' (no change)'}`,
      );
      if (done.changed) {
        await this.timeline(run, cfg.action === 'add' ? 'tag_added' : 'tag_removed', {
          tagId: done.tagUuid,
          tagName: done.tagName,
          source: 'flow',
        });
      }
    } catch (err) {
      ctx.note(`tag step failed: ${reasonOf(err)}`);
    }
    return advance;
  }

  /** TW-FLR-036. Hands the conversation to a member and/or a team, with an optional note for them. */
  private async assign(ctx: NodeContext): Promise<NodeResult> {
    // The Human handoff (BL-398) saves `handoff: 2`; a node saved before it is the old Assign agent and runs exactly as it did.
    if (data(ctx).handoff === 2) return this.humanHandoff(ctx);
    const cfg = assignConfig(data(ctx), ctx.render);
    if (!cfg.teamId && !cfg.userId) {
      ctx.note('no team or agent chosen: skipped');
      return advance;
    }
    if ((cfg.userId && !UUID_RE.test(cfg.userId)) || (cfg.teamId && !UUID_RE.test(cfg.teamId))) {
      ctx.note('assignment failed: that member or team is not part of this workspace');
      return advance;
    }
    const run = ctx.run;
    try {
      const thread = run.channelUuid
        ? await this.conversations.findThread(run.channelUuid, run.peerKey)
        : null;
      if (!thread) {
        ctx.note('assignment failed: the customer has no conversation yet');
        return advance;
      }
      const out = await this.assignment.assignFromFlow(run.orgId, {
        conversationUuid: thread.id,
        ...(cfg.userId ? { userId: cfg.userId } : {}),
        ...(cfg.teamId ? { teamId: cfg.teamId } : {}),
        ...(cfg.note ? { note: cfg.note } : {}),
      });
      ctx.note(out.changed ? 'conversation assigned' : 'conversation already assigned there');
    } catch (err) {
      ctx.note(`assignment failed: ${reasonOf(err)}`);
    }
    return advance;
  }

  /**
   * The Human handoff node (BL-398): the same action an AI agent or a person uses (`HandoffService`). It leaves by `assigned` (1) when a
   * person has the conversation, `waiting` (2) when it waits in a queue, `unavailable` (3) when it is out of hours or nobody could take it.
   * From here the conversation is muted for the bot; the flow goes on along the wired path but a later customer message is not delivered
   * to the run until the conversation is given back to the bot.
   */
  private async humanHandoff(ctx: NodeContext): Promise<NodeResult> {
    const cfg = handoffConfig(data(ctx), ctx.render);
    const run = ctx.run;
    const bad = (u: string) => u !== '' && !UUID_RE.test(u);
    if (bad(cfg.userId) || bad(cfg.teamId)) {
      ctx.note('handoff failed: that member or team is not part of this workspace: no agent port');
      return { kind: 'advance', port: HANDOFF_PORTS.unavailable };
    }
    let destination: HandoffDestination;
    if (cfg.destination === 'person' && cfg.userId !== '') {
      destination = { kind: 'person', userId: cfg.userId, ...(cfg.teamId ? { teamId: cfg.teamId } : {}) };
    } else if (cfg.destination === 'team' && cfg.teamId !== '') {
      destination = { kind: 'team', teamId: cfg.teamId };
    } else destination = { kind: 'rules' };
    try {
      const thread = run.channelUuid
        ? await this.conversations.findThread(run.channelUuid, run.peerKey)
        : null;
      if (!thread) {
        ctx.note('handoff failed: the customer has no conversation yet: no agent port');
        return { kind: 'advance', port: HANDOFF_PORTS.unavailable };
      }
      const priority = conversationPrioritySchema.safeParse(cfg.priority);
      const out = await this.handoff.handoff({
        orgId: run.orgId,
        conversationUuid: thread.id,
        source: 'flow',
        reason: (HANDOFF_REASONS as readonly string[]).includes(cfg.reason) ? (cfg.reason as HandoffReason) : 'other',
        reasonText: cfg.note || null,
        summary: cfg.summary || null,
        answers: run.vars,
        destination,
        priority: priority.success ? priority.data : null,
        customerMessage: cfg.customerMessage || null,
        offHoursMessage: cfg.offHoursMessage || null,
        messageText: typeof run.vars.user_message === 'string' ? run.vars.user_message : null,
        idempotencyKey: `flow:${ctx.stepKey}`,
        flow: { runId: run.id, nodeId: ctx.node.id },
        actor: { kind: 'flow' },
      });
      if (out.refused) ctx.note(`handoff refused: ${out.refused}`);
      else
        ctx.note(
          `handoff ${out.outcome}${out.duplicate ? ' (already done)' : ''}: ${out.trace
            .filter((t) => t.result === 'chosen')
            .map((t) => t.why ?? t.step)
            .join(', ') || 'queued'}`,
        );
      return { kind: 'advance', port: HANDOFF_PORTS[out.outcome] };
    } catch (err) {
      ctx.note(`handoff failed: ${reasonOf(err)}`);
      return { kind: 'advance', port: HANDOFF_PORTS.unavailable };
    }
  }

  /** TW-FLR-037. Creates a deal (or moves the contact's open one) in a stage: `created` (1) on success, `error` (2) otherwise. */
  private async deal(ctx: NodeContext): Promise<NodeResult> {
    const run = ctx.run;
    const cfg = dealConfig(data(ctx), ctx.render, run.vars);
    if (!cfg.stageId) {
      ctx.note('no stage chosen: error port');
      return { kind: 'advance', port: 2 };
    }
    if (!UUID_RE.test(cfg.stageId) || (cfg.ownerId && !UUID_RE.test(cfg.ownerId))) {
      ctx.note('the stage or owner is not part of this workspace: error port');
      return { kind: 'advance', port: 2 };
    }
    try {
      const done = await this.deals.flowAction({
        action: cfg.action,
        stageId: cfg.stageId,
        title: cfg.title,
        value: cfg.value,
        ownerId: cfg.ownerId || null,
        contact:
          run.contactId !== null && run.contactUuid
            ? { id: run.contactId, uuid: run.contactUuid }
            : null,
      });
      run.vars[cfg.saveAs] = done.dealId;
      ctx.note(`deal ${done.created ? 'created' : 'moved'} (${cfg.saveAs} = ${done.dealId})`);
      return { kind: 'advance', port: 1 };
    } catch (err) {
      ctx.note(`deal step failed: ${reasonOf(err)}: error port`);
      return { kind: 'advance', port: 2 };
    }
  }

  /** TW-FLR-038. Sends the last message the customer was sent (or the node's own text or file) to a fixed number. */
  private async notify(ctx: NodeContext): Promise<NodeResult> {
    const plan = notifyPlan(data(ctx), ctx.run.lastOut, ctx.render);
    if (!plan.send) {
      ctx.note(`copy to number skipped: ${plan.why}`);
      return advance;
    }
    const out = await this.numbers.send(ctx.run, plan.to, plan.message, `${ctx.stepKey}:copy`);
    if (!out.ok) ctx.note(`copy to ${plan.to} failed: ${out.error}`);
    return advance;
  }

  /** TW-FLR-039. DMs the customer an `ig.me` link that opens a chat with the business's Instagram. */
  private async instagram(ctx: NodeContext): Promise<NodeResult> {
    const body = instagramMessage(data(ctx), ctx.render);
    if (body === null) {
      ctx.note('no Instagram username: skipped');
      return advance;
    }
    const out = await ctx.send({ kind: 'text', body });
    if (out.ok) return advance;
    if (out.halt) return haltOf(out);
    ctx.note(`send failed: ${out.error}`);
    return advance;
  }

  /** A line on the conversation timeline, as Reference wrote one for a flow's tag. Best effort: a timeline problem never fails the node. */
  private async timeline(
    run: RunState,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (!run.channelUuid) return;
      const thread = await this.conversations.findThread(run.channelUuid, run.peerKey);
      if (!thread) return;
      await this.db.txAs({ orgId: run.orgId }, async (tx) => {
        const locked = await this.conversationsRepo.lockByUuid(tx, run.orgId, thread.id);
        if (!locked) return;
        await this.events.append(tx, run.orgId, {
          conversationId: locked.id,
          type,
          actorKind: 'flow',
          payload,
        });
      });
    } catch (err) {
      this.logger.warn({ err }, '[FLR] could not write a timeline line');
    }
  }
}
