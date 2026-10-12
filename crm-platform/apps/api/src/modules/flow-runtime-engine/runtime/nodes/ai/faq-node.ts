import { Injectable } from '@nestjs/common';
import { FaqFlowService, type FlowFaqAnswer } from '../../../../faq-knowledge';
import type { NodeContext, NodeExecutor, NodeResult } from '../../types';
import { sendFailed } from '../commerce/send-failure';
import { dataOf, str } from '../integrations/webhook-node';

const MATCHED = 1;
const NO_MATCH = 2;
const miss: NodeResult = { kind: 'advance', port: NO_MATCH, branch: true };

/** What the node needs from outside: the FAQ matcher. Faked in the unit tests. */
export interface FaqNodeDeps {
  answer: FaqFlowService['answer'];
}

/**
 * "Answer from FAQ" node (ADR-0021 addendum): matches a message of the run (by default the customer's last one, `{{user_message}}`;
 * a variable a Question node saved works too) against the workspace's FAQs by meaning, and either answers or lets the flow branch.
 *
 * A match by `matched` (1): a text FAQ is sent to the customer unless the node's "send the answer" is off; a flow FAQ enters its flow,
 * at the FAQ's chosen step when it has one (the run continues in that flow and does not come back). A flow that is gone, not live, or
 * has lost that step leaves by `no_match` (2), as does anything that is not a match. Either way the result is saved as
 * `<save>.matched` (yes/no), `.score`, `.question`, `.answer` and `.id`, so a later Condition or message can use it.
 */
export async function runFaq(ctx: NodeContext, deps: FaqNodeDeps): Promise<NodeResult> {
  const d = dataOf(ctx);
  const run = ctx.run;
  const saveAs = str(d.variable, 'faq') || 'faq';
  const set = (
    matched: boolean,
    score: number | null,
    question = '',
    answer = '',
    id = '',
  ): void => {
    run.vars[`${saveAs}.matched`] = matched ? 'yes' : 'no';
    run.vars[`${saveAs}.score`] = score ?? '';
    run.vars[`${saveAs}.question`] = question;
    run.vars[`${saveAs}.answer`] = answer;
    run.vars[`${saveAs}.id`] = id;
  };

  const query = ctx.render(d.query).trim();
  const minRaw = d.minScore;
  const minScore = minRaw === null || minRaw === undefined || minRaw === '' ? null : Number(minRaw);
  let out: FlowFaqAnswer;
  try {
    out = await deps.answer(run.orgId, {
      query,
      category: str(d.category).trim() || null,
      minScore: minScore !== null && Number.isFinite(minScore) ? minScore : null,
      conversationId: run.conversationId,
      channelId: run.channelId,
    });
  } catch (e) {
    ctx.note(`faq: the match could not run (${e instanceof Error ? e.message : String(e)})`);
    set(false, null);
    return miss;
  }

  if (out.status !== 'matched') {
    ctx.note(`faq: no answer (${out.reason})`);
    set(false, out.status === 'no_match' ? out.score : null);
    return miss;
  }

  set(true, out.score, out.question, out.answerText ?? '', out.faqUuid);
  if (out.answerType === 'flow') {
    if (out.flowId === null) {
      ctx.note('faq: the flow this FAQ starts no longer exists');
      set(false, out.score, out.question);
      return miss;
    }
    ctx.note(`faq: "${out.question}" (${out.score}) starts its flow`);
    return {
      kind: 'subflow',
      flowId: out.flowId,
      ...(out.flowNodeId ? { startNodeId: out.flowNodeId } : {}),
      missPort: NO_MATCH,
      // The match stands but its flow could not be entered: the run takes no_match, and the variables must say so too.
      missVars: { [`${saveAs}.matched`]: 'no' },
    };
  }

  ctx.note(`faq: "${out.question}" matched at ${out.score}`);
  if (d.sendAnswer !== false && out.answerText) {
    const sent = await ctx.send({ kind: 'text', body: out.answerText });
    if (!sent.ok) {
      const failed = sendFailed(sent, 'end', ctx);
      if (failed) return failed;
    }
  }
  return { kind: 'advance', port: MATCHED, branch: true };
}

/** The executor group for the `Faq` node type (`faq` in the builder). */
@Injectable()
export class FaqNodes implements NodeExecutor {
  readonly types: readonly string[] = ['Faq'];

  constructor(private readonly faq: FaqFlowService) {}

  execute(ctx: NodeContext): Promise<NodeResult> {
    return runFaq(ctx, { answer: (orgId, input) => this.faq.answer(orgId, input) });
  }
}
