import { Injectable, Logger } from '@nestjs/common';
import {
  FLB_ASK_MAX_RETRIES,
  flbAskInputCheck,
  flbAskInputWrongText,
  flbCleanAskInputType,
  flbCleanDateFormat,
  flbParseDate,
} from '@crm/contracts';
import { ContactsService } from '../../../../crm';
import type {
  CustomDecision,
  InboundReply,
  NodeContext,
  NodeExecutor,
  NodeResult,
  SendOutcome,
} from '../../types';

/**
 * The checked question (`AskInput`): an Ask whose author chose "Validate as" name, email, phone, number, alphanumeric or date. Not
 * WaDesk (its Ask saved that setting and never read it). The compiler turns such an Ask into this node; an Ask with fixed answers, a
 * file upload or free text stays the plain `Question`. It works like the console chatbot's input nodes and the Ask for file node:
 * the question is sent and the run parks as a `Custom` wait; the next message reaches `onReply`:
 *
 *  - an answer that passes: it is saved in the variable (and, when asked, on a contact property) and the run leaves by its one port
 *  - anything else: the wrong-answer text is sent (not the question again, as in the console) and the run keeps waiting. With
 *    `maxRetries` 0 it asks for ever, as the console does (the run's own idle limit still ends it); with a number, after that many
 *    wrong answers the run moves on without an answer (`onGiveUp: continue`) or ends (`end`)
 */

const HANDLER = 'AskInput';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown, fallback: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/** Variables every outcome writes, so a Condition after the node can branch on `{{<var>_status}}`. */
const status = (variable: string, value: 'received' | 'failed') => ({
  [`${variable}_status`]: value,
});

@Injectable()
export class AskInputNode implements NodeExecutor {
  readonly types: readonly string[] = [HANDLER];
  private readonly logger = new Logger(AskInputNode.name);

  constructor(private readonly contacts: ContactsService) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const p = ctx.node.props;
    let question = ctx.render(p.question);
    if (question.trim() === '') {
      // A prompt that renders empty would send a blank bubble and swallow the next message as the "answer".
      question = 'Please type your answer.';
      ctx.note('the question rendered empty: used a visible fallback');
    }
    const out = await ctx.send({ kind: 'text', body: question });
    if (!out.ok) return this.sendFailed(out, ctx);
    return {
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable: str(p.variable) || 'answer',
        kind: 'Custom',
        handler: HANDLER,
        data: { attempts: 0 },
      },
    };
  }

  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    // An outside event (a form submission) is not an answer to this question.
    if (reply.kind === 'external') return { action: 'ignore' };
    const p = ctx.node.props;
    const type = flbCleanAskInputType(p.inputType);
    const dateFormat = flbCleanDateFormat(p.dateFormat);
    const variable = str(p.variable) || 'answer';

    if (reply.kind === 'text') {
      const checked = flbAskInputCheck(type, reply.text, { dateFormat });
      if (checked.ok) {
        const value = checked.value;
        await this.saveProperty(ctx, str(p.savePropertyKey), value);
        const iso = type === 'date' ? flbParseDate(value, dateFormat) : null;
        return {
          action: 'route',
          port: 1,
          setVars: {
            [variable]: value,
            [ctx.node.id]: value,
            user_message: value,
            ...(iso ? { [`${variable}_iso`]: iso } : {}),
            ...status(variable, 'received'),
          },
        };
      }
    }
    return this.wrong(ctx, type, dateFormat, variable);
  }

  /** Not what was asked for: say so and wait again, or give up once the retries (when there is a limit) are used. */
  private async wrong(
    ctx: NodeContext,
    type: ReturnType<typeof flbCleanAskInputType>,
    dateFormat: string,
    variable: string,
  ): Promise<CustomDecision> {
    const p = ctx.node.props;
    const limit = Math.min(FLB_ASK_MAX_RETRIES, Math.max(0, num(p.maxRetries, 0)));
    const attempts = num(ctx.run.wait?.data?.attempts, 0) + 1;
    if (limit === 0 || attempts <= limit) {
      const text = str(p.wrongReplyText).trim() || flbAskInputWrongText(type, dateFormat);
      const out = await ctx.send({ kind: 'text', body: ctx.render(text) });
      if (!out.ok) ctx.note(`the wrong-answer message was not sent: ${out.error}`);
      return { action: 'stay', data: { attempts } };
    }
    if (str(p.onGiveUp) === 'end') {
      ctx.note('wrong answers used up: the run ended');
      return { action: 'end', reason: 'end_node' };
    }
    ctx.note('wrong answers used up: moved on without an answer');
    return {
      action: 'route',
      port: 1,
      setVars: { [variable]: '', [ctx.node.id]: '', ...status(variable, 'failed') },
    };
  }

  /** "Also save on a contact property". A failure never stops the flow. */
  private async saveProperty(ctx: NodeContext, key: string, value: string): Promise<void> {
    if (key === '' || value === '') return;
    if (ctx.run.contactId === null) {
      ctx.note('this run has no contact to save the answer on: skipped');
      return;
    }
    try {
      const done = await this.contacts.setPropertyFromFlow(
        ctx.run.orgId,
        ctx.run.contactId,
        key,
        value,
      );
      ctx.note(
        done ? `answer saved on the contact property "${key}"` : `no contact property "${key}"`,
      );
    } catch (err) {
      this.logger.warn({ err }, '[FLR] saving the answer on a contact property failed');
      ctx.note(`the contact property could not be saved: ${(err as Error).message}`);
    }
  }

  private sendFailed(out: Extract<SendOutcome, { ok: false }>, ctx: NodeContext): NodeResult {
    if (out.halt) return { kind: 'halt', reason: out.error };
    ctx.note(`send failed: ${out.error}`);
    return { kind: 'fail', code: out.code, reason: out.error };
  }
}
