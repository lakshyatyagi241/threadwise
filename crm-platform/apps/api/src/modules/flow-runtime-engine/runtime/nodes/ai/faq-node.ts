import { Injectable } from '@nestjs/common';
import type { NodeContext, NodeExecutor, NodeResult } from '../../types';
import { dataOf, str } from '../integrations/webhook-node';

const NO_MATCH = 2;

/**
 * The "Answer from FAQ" step is retired: FAQs are now entries of an AI agent's knowledge base, and an AI step that runs as that agent
 * answers from them. A flow saved with the old step keeps running: the step reports no match and the flow leaves by its "No match"
 * exit, as it did for a message no FAQ answered. Its variables are set empty so later steps that read them see "no match".
 */
@Injectable()
export class FaqNodes implements NodeExecutor {
  readonly types: readonly string[] = ['Faq'];

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const saveAs = str(dataOf(ctx).variable, 'faq') || 'faq';
    ctx.run.vars[`${saveAs}.matched`] = 'no';
    ctx.run.vars[`${saveAs}.score`] = '';
    ctx.run.vars[`${saveAs}.question`] = '';
    ctx.run.vars[`${saveAs}.answer`] = '';
    ctx.run.vars[`${saveAs}.id`] = '';
    ctx.note('faq: this step is retired; the flow continues through "No match"');
    return { kind: 'advance', port: NO_MATCH, branch: true };
  }
}
