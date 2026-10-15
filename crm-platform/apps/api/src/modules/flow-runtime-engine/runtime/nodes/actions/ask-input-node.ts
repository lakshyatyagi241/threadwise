import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FLB_ASK_MAX_RETRIES,
  FLB_OTP,
  FLB_OTP_TEXT,
  flbAskInputCheck,
  flbAskInputWrongText,
  flbCleanAskInputType,
  flbCleanDateFormat,
  flbParseDate,
} from '@crm/contracts';
import { RateLimitService } from '../../../../auth';
import { ContactsService } from '../../../../crm';
import {
  OTP_SENDER_PORT,
  type OtpSenderPort,
} from '../../../../../infra/providers/auth-registration-security/otp-sender.port';
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
 * Reference (its Ask saved that setting and never read it). The compiler turns such an Ask into this node; an Ask with fixed answers, a
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

  constructor(
    private readonly contacts: ContactsService,
    @Inject(OTP_SENDER_PORT) private readonly otp: OtpSenderPort,
    private readonly limits: RateLimitService,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const p = ctx.node.props;
    let question = ctx.render(p.question);
    if (question.trim() === '') {
      // A prompt that renders empty would send a blank bubble and swallow the next message as the "answer".
      question = 'Please type your answer.';
      ctx.note('the question rendered empty: used a visible fallback');
    }
    const inputType = flbCleanAskInputType(p.inputType);
    const out = await ctx.send({
      kind: 'text',
      body: question,
      input: {
        type: inputType,
        ...(inputType === 'date' ? { format: flbCleanDateFormat(p.dateFormat) } : {}),
      },
    });
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
    const verify = type === 'phone' && p.verifyOtp === true;

    // A phone question that verifies the number: the code is what the visitor sends next.
    if (verify && str(ctx.run.wait?.data?.stage) === 'code')
      return this.checkCode(ctx, reply, variable);

    if (reply.kind === 'text') {
      const checked = flbAskInputCheck(type, reply.text, { dateFormat });
      if (checked.ok) {
        const value = checked.value;
        if (verify) return this.startCode(ctx, value, variable, 0);
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

  private say(ctx: NodeContext, body: string, input: string): Promise<SendOutcome> {
    return ctx.send({ kind: 'text', body, input: { type: input } });
  }

  /**
   * Sends a one-time code to the number and waits for it. The number must carry its country code (+), a number can ask for three codes
   * every ten minutes, a workspace for a hundred a day; a sender that fails says so to the visitor, who may try the number again.
   */
  private async startCode(
    ctx: NodeContext,
    phone: string,
    variable: string,
    resends: number,
  ): Promise<CustomDecision> {
    if (!phone.startsWith('+')) {
      await this.say(ctx, FLB_OTP_TEXT.needCountryCode, 'phone');
      return { action: 'stay', data: { attempts: num(ctx.run.wait?.data?.attempts, 0) } };
    }
    const day = ctx.now().toISOString().slice(0, 10);
    const org = await this.limits.hit(`flow-otp:org:${ctx.run.orgId}:${day}`, 86_400);
    const number = await this.limits.hit(
      `flow-otp:phone:${createHash('sha256').update(phone).digest('hex').slice(0, 24)}`,
      FLB_OTP.perPhoneWindowSeconds,
    );
    if (org.count > FLB_OTP.perOrgPerDay || number.count > FLB_OTP.perPhone) {
      await this.say(ctx, FLB_OTP_TEXT.tooMany, 'text');
      ctx.note('a code was refused: too many codes asked for');
      return this.giveUp(ctx, variable, 'failed');
    }
    const code = String(randomInt(0, 10 ** FLB_OTP.digits)).padStart(FLB_OTP.digits, '0');
    const salt = randomBytes(8).toString('hex');
    try {
      await this.otp.send({ to: phone, code, ttlMinutes: FLB_OTP.ttlMinutes });
    } catch (err) {
      this.logger.warn({ err }, '[FLR] sending the verification code failed');
      ctx.note('the verification code could not be sent');
      await this.say(ctx, FLB_OTP_TEXT.sendFailed, 'phone');
      return { action: 'stay', data: { attempts: num(ctx.run.wait?.data?.attempts, 0) } };
    }
    await this.say(
      ctx,
      FLB_OTP_TEXT.sent.replace('{phone}', phone).replace('{minutes}', String(FLB_OTP.ttlMinutes)),
      'number',
    );
    return {
      action: 'stay',
      data: {
        stage: 'code',
        phone,
        salt,
        hash: this.digest(salt, code),
        exp: ctx.now().getTime() + FLB_OTP.ttlMinutes * 60_000,
        tries: 0,
        resends,
        attempts: num(ctx.run.wait?.data?.attempts, 0),
      },
    };
  }

  private digest(salt: string, code: string): string {
    return createHash('sha256').update(`${salt}:${code}`).digest('hex');
  }

  /** The visitor's answer to the code question: the code, "resend", or something else (a wrong try). */
  private async checkCode(
    ctx: NodeContext,
    reply: InboundReply,
    variable: string,
  ): Promise<CustomDecision> {
    const d = ctx.run.wait?.data ?? {};
    const text = reply.kind === 'text' ? reply.text.trim() : '';
    const resends = num(d.resends, 0);
    if (/^resend$/i.test(text)) {
      if (resends >= FLB_OTP.maxResends) {
        await this.say(ctx, FLB_OTP_TEXT.noMoreCodes, 'number');
        return { action: 'stay', data: { ...d } };
      }
      return this.startCode(ctx, str(d.phone), variable, resends + 1);
    }
    if (ctx.now().getTime() > num(d.exp, 0)) {
      await this.say(ctx, FLB_OTP_TEXT.expired, 'number');
      return { action: 'stay', data: { ...d } };
    }
    const have = Buffer.from(this.digest(str(d.salt), text), 'hex');
    const want = Buffer.from(str(d.hash), 'hex');
    if (text !== '' && have.length === want.length && timingSafeEqual(have, want)) {
      const phone = str(d.phone);
      await this.saveProperty(ctx, str(ctx.node.props.savePropertyKey), phone);
      return {
        action: 'route',
        port: 1,
        setVars: {
          [variable]: phone,
          [ctx.node.id]: phone,
          user_message: phone,
          [`${variable}_verified`]: 'yes',
          ...status(variable, 'received'),
        },
      };
    }
    const tries = num(d.tries, 0) + 1;
    if (tries >= FLB_OTP.maxTries) {
      await this.say(ctx, FLB_OTP_TEXT.wrong, 'text');
      return this.giveUp(ctx, variable, 'failed');
    }
    await this.say(ctx, FLB_OTP_TEXT.wrong, 'number');
    // A `stay` replaces the wait's data, so everything the code check needs is carried over.
    return { action: 'stay', data: { ...d, tries } };
  }

  /** The number could not be verified: the run moves on without it (or ends, as the author chose), with the variable empty. */
  private giveUp(ctx: NodeContext, variable: string, outcome: 'failed'): CustomDecision {
    if (str(ctx.node.props.onGiveUp) === 'end') return { action: 'end', reason: 'end_node' };
    return {
      action: 'route',
      port: 1,
      setVars: {
        [variable]: '',
        [ctx.node.id]: '',
        [`${variable}_verified`]: 'no',
        ...status(variable, outcome),
      },
    };
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
      // The retry keeps the question's input (the window still shows the same keyboard or date picker).
      const out = await ctx.send({
        kind: 'text',
        body: ctx.render(text),
        input: { type, ...(type === 'date' ? { format: dateFormat } : {}) },
      });
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
