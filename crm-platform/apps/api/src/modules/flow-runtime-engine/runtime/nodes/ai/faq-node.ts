import { Injectable } from '@nestjs/common';
import { KbRetrievalService } from '../../../../knowledge-base';
import type { NodeContext, NodeExecutor, NodeResult } from '../../types';
import { FlowRefResolver, firstFlowRef } from '../flow-refs';
import { dataOf, str } from '../integrations/webhook-node';

const MATCHED = 1;
const NO_MATCH = 2;

/** A question-and-answer entry reads `Q: ...\nA: ...` (kb.rules `sourceText`); anything else is a text passage with no question. */
function splitPassage(text: string): { question: string; answer: string } {
  const m = /^Q:\s*([\s\S]*?)\nA:\s*([\s\S]*)$/.exec(text);
  return m ? { question: m[1].trim(), answer: m[2].trim() } : { question: '', answer: text.trim() };
}

/**
 * "Answer from knowledge base" (node type `faq`): searches the chosen AI agent's knowledge base by meaning for the customer's message
 * (the same search the AI step and the website chat use, no model call). A match leaves by "Matched" with the best passage in the
 * step's variables and, when the step is set to, sent to the customer; no match (nothing found, the search could not run, no agent
 * chosen or an agent of another workspace) leaves by "No match". A flow saved with the old step has no agent, so it keeps leaving by
 * "No match". Its variables are set empty on no match so later steps that read them see it.
 */
@Injectable()
export class FaqNodes implements NodeExecutor {
  readonly types: readonly string[] = ['Faq'];

  constructor(
    private readonly retrieval: KbRetrievalService,
    private readonly refs: FlowRefResolver,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const d = dataOf(ctx);
    const saveAs = str(d.variable, 'faq') || 'faq';
    const clear = () => {
      ctx.run.vars[`${saveAs}.matched`] = 'no';
      ctx.run.vars[`${saveAs}.score`] = '';
      ctx.run.vars[`${saveAs}.question`] = '';
      ctx.run.vars[`${saveAs}.answer`] = '';
      ctx.run.vars[`${saveAs}.id`] = '';
    };
    clear();

    const ref = firstFlowRef(d.assistant_id, d.assistantId, d.assistant);
    const assistantId = await this.refs.assistantId(ctx.run.orgId, ref);
    if (assistantId <= 0) {
      ctx.note('faq: no AI agent chosen (or it no longer exists): leaving by "No match"');
      return { kind: 'advance', port: NO_MATCH, branch: true };
    }

    const query = ctx.render(d.query ?? '{{user_message}}').trim();
    const found = await this.retrieval.retrieve(ctx.run.orgId, assistantId, query);
    // Only passages the search matched count: text it has not indexed yet is appended to the list as context, not as a match.
    const best = found.grounded
      ? found.passages.slice(0, found.hits ?? 0).find((p) => p.text.trim() !== '')
      : undefined;
    if (!best) {
      ctx.note('faq: nothing in the knowledge base matches: leaving by "No match"');
      return { kind: 'advance', port: NO_MATCH, branch: true };
    }

    const { question, answer } = splitPassage(best.text);
    ctx.run.vars[`${saveAs}.matched`] = 'yes';
    ctx.run.vars[`${saveAs}.question`] = question;
    ctx.run.vars[`${saveAs}.answer`] = answer;
    if (d.sendAnswer !== false) {
      const sent = await ctx.send({ kind: 'text', body: answer });
      if (!sent.ok) {
        if (sent.halt) return { kind: 'halt', reason: sent.error };
        ctx.note(`faq: the answer could not be sent: ${sent.error}`);
      }
    }
    return { kind: 'advance', port: MATCHED, branch: true };
  }
}
