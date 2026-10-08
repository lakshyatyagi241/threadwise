import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { OutboxService } from '../../../../../kernel/outbox/outbox.service';
import type { NodeContext, NodeExecutor, NodeResult } from '../../types';
import { handoffPlan } from './social-handoff-rules';

export const WHATSAPP_HANDOFF_EVENT = 'flow.whatsapp_handoff_requested';

const advance: NodeResult = { kind: 'advance', port: 1 };

/**
 * "Hand off to WhatsApp" for Instagram and Messenger flows (WD-FLR-010 rule 6). Deep-link mode sends a `wa.me` link in the chat. Direct
 * mode says the intro and announces `flow.whatsapp_handoff_requested`; the worker's `SocialHandoffConsumer` finds or creates the
 * WhatsApp contact for the captured number and starts the chosen flow, so this node never needs the launch service (which needs the
 * engine, which needs this node).
 *
 * Like every action node, a step never stops the flow: a missing number or flow is a line in the run log and the chat moves on. Only
 * a channel that is down halts the run (the intro is a send to the customer).
 */
@Injectable()
export class SocialHandoffNode implements NodeExecutor {
  readonly types: readonly string[] = ['SocialHandoff'];

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const raw = ctx.node.props.data;
    const data = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const plan = handoffPlan(data, ctx.render, ctx.run.vars);
    if (plan.mode === 'skip') {
      ctx.note(`hand-off to WhatsApp skipped: ${plan.why}`);
      return advance;
    }
    const text = plan.mode === 'link' ? plan.text : plan.intro;
    if (text !== '') {
      const out = await ctx.send({ kind: 'text', body: text });
      if (!out.ok) {
        if (out.halt) return { kind: 'halt', reason: out.error };
        ctx.note(`send failed: ${out.error}`);
      }
    }
    if (plan.mode === 'direct') {
      const run = ctx.run;
      await this.db.txAs({ orgId: run.orgId }, (tx) =>
        this.outbox.emit(tx, {
          orgId: run.orgId,
          aggregateModule: 'flow_runtime_engine',
          aggregateId: run.id,
          eventType: WHATSAPP_HANDOFF_EVENT,
          payload: {
            number: plan.number,
            flowRef: String(plan.flowRef),
            variables: plan.variables,
            key: ctx.stepKey,
          },
        }),
      );
      ctx.note(`WhatsApp flow requested for ${plan.number}`);
    }
    return advance;
  }
}
