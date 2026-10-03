import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../../../../chat-conversations';
import { DealsService, TagsService } from '../../../../crm';
import {
  ConversationEventsRepository,
  ConversationsRepository,
} from '../../../../team-inbox-conversations';
import { AssignmentService } from '../../../../team-inbox-routing-sla';
import type { NodeContext, NodeExecutor, NodeResult, RunState } from '../../types';
import {
  assignConfig,
  dealConfig,
  instagramMessage,
  notifyPlan,
  tagConfig,
  UUID_RE,
} from './actions-config';
import { NumberSender } from './number-sender.service';

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
    if (out.halt) return { kind: 'halt', reason: out.error };
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
