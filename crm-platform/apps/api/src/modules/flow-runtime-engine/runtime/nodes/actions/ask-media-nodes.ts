import { Injectable, Logger } from '@nestjs/common';
import {
  FLB_ASK_GIVE_UP_MODES,
  FLB_ASK_MAX_RETRIES,
  flbAskFileAccepts,
  flbCleanAskFileExtensions,
  type FlbAskGiveUp,
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
 * "Ask for file / image" (`AskFile`) and "Ask for location" (`AskLocation`): not WaDesk nodes, an addition the project owner asked
 * for (WD-FLB-081, 082). Both work the way a Google Form or WhatsApp Form node does: the node sends its prompt and parks the run as a
 * `Custom` wait; the customer's next message reaches `onReply`, which decides:
 *
 *  - the right kind of message (a file that passes the allow-list; a shared location): its parts go into the variables and the run
 *    leaves by its one port
 *  - the skip word, when the author set one: the run leaves with `<var>_status = skipped` and empty values
 *  - anything else is a wrong reply: the author's "wrong reply" text is sent and the run keeps waiting, up to `maxRetries` times; then
 *    the run leaves with `<var>_status = failed` (`onGiveUp = continue`) or ends (`end`)
 *
 * The wait itself is the run's idle limit, or `timeoutMinutes` when the author set one (an Ask node has no timeout of its own; a run
 * that waits too long ends `idle_timeout`, the same here).
 */

const HANDLER_FILE = 'AskFile';
const HANDLER_LOCATION = 'AskLocation';
const DEFAULT_HINT =
  'Tap the attachment (+) button, choose Location, then send your current location.';
const DEFAULT_FILE_WRONG = 'That is not a file we can accept. Please send it as an attachment.';
const DEFAULT_LOCATION_WRONG =
  'Please share your location with the attachment (+) menu, then Location.';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown, fallback: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : fallback;
};
const lc = (s: string): string => s.trim().toLowerCase();

export interface AskWaitSettings {
  maxRetries: number;
  wrongReplyText: string;
  skipKeyword: string;
  onGiveUp: FlbAskGiveUp;
  timeoutMinutes: number;
}

/** The settings both nodes share, read from the compiled props with the editor's defaults when a field is missing. */
export function askWaitSettings(props: Record<string, unknown>, fallback: string): AskWaitSettings {
  const mode = str(props.onGiveUp);
  return {
    maxRetries: Math.min(FLB_ASK_MAX_RETRIES, Math.max(0, num(props.maxRetries, 2))),
    wrongReplyText: str(props.wrongReplyText).trim() === '' ? fallback : str(props.wrongReplyText),
    skipKeyword: str(props.skipKeyword).trim(),
    onGiveUp: (FLB_ASK_GIVE_UP_MODES as readonly string[]).includes(mode)
      ? (mode as FlbAskGiveUp)
      : 'continue',
    timeoutMinutes: Math.max(0, num(props.timeoutMinutes, 0)),
  };
}

/** Variables every outcome writes, so a Condition after the node can branch on `{{<var>_status}}`. */
const status = (variable: string, value: 'received' | 'skipped' | 'failed') => ({
  [`${variable}_status`]: value,
});

@Injectable()
export class AskMediaNodes implements NodeExecutor {
  readonly types: readonly string[] = [HANDLER_FILE, HANDLER_LOCATION];
  private readonly logger = new Logger(AskMediaNodes.name);

  constructor(private readonly contacts: ContactsService) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const location = ctx.node.type === HANDLER_LOCATION;
    const p = ctx.node.props;
    let question = ctx.render(p.question);
    if (question.trim() === '') {
      // A prompt that renders empty would send a blank bubble and swallow the next message as the "answer".
      question = location
        ? 'Please share your location.'
        : 'Please send the file or image we asked for.';
      ctx.note('the question rendered empty: used a visible fallback');
    }
    const settings = askWaitSettings(p, location ? DEFAULT_LOCATION_WRONG : DEFAULT_FILE_WRONG);
    const out = await ctx.send(
      location
        ? p.interactive === false
          ? { kind: 'text', body: question }
          : { kind: 'location_request', body: question, hint: DEFAULT_HINT }
        : { kind: 'text', body: question },
    );
    if (!out.ok) return this.sendFailed(out, ctx);
    const variable = str(p.variable) || (location ? 'location' : 'file');
    return {
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable,
        kind: 'Custom',
        handler: ctx.node.type,
        data: { attempts: 0 },
        ...(settings.timeoutMinutes > 0 ? { timeoutSeconds: settings.timeoutMinutes * 60 } : {}),
      },
    };
  }

  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    // An outside event (a form submission) or an empty reaction is not an answer to this question.
    if (reply.kind === 'external') return { action: 'ignore' };
    const location = ctx.node.type === HANDLER_LOCATION;
    const p = ctx.node.props;
    const settings = askWaitSettings(p, location ? DEFAULT_LOCATION_WRONG : DEFAULT_FILE_WRONG);
    const variable = str(p.variable) || (location ? 'location' : 'file');

    if (
      settings.skipKeyword !== '' &&
      reply.kind === 'text' &&
      lc(reply.text) === lc(settings.skipKeyword)
    ) {
      ctx.note('the customer skipped the question');
      return {
        action: 'route',
        port: 1,
        setVars: { ...this.emptyVars(variable, location), ...status(variable, 'skipped') },
      };
    }

    if (location && reply.kind === 'location') {
      const d = reply.data ?? {};
      const link = str(d.link);
      return {
        action: 'route',
        port: 1,
        setVars: {
          [variable]: link,
          [ctx.node.id]: link,
          [`${variable}_latitude`]: Number(d.latitude),
          [`${variable}_longitude`]: Number(d.longitude),
          [`${variable}_name`]: str(d.name),
          [`${variable}_address`]: str(d.address),
          [`${variable}_link`]: link,
          ...status(variable, 'received'),
        },
      };
    }

    if (!location && reply.kind === 'media') {
      const d = reply.data ?? {};
      const mime = str(d.mime);
      const name = str(d.name);
      const accepted = flbAskFileAccepts(flbCleanAskFileExtensions(p.extensions), { name, mime });
      if (accepted) {
        const url = reply.mediaUrl ?? '';
        if (url === '') ctx.note('the file is still being stored: no link yet');
        await this.saveProperty(ctx, str(p.savePropertyKey), url);
        return {
          action: 'route',
          port: 1,
          setVars: {
            [variable]: url,
            [ctx.node.id]: url,
            [`${variable}_url`]: url,
            [`${variable}_kind`]: str(d.mediaKind),
            [`${variable}_name`]: name,
            [`${variable}_mime`]: mime,
            [`${variable}_caption`]: str(d.caption),
            ...status(variable, 'received'),
          },
        };
      }
      ctx.note(`a file of type ${mime || name || 'unknown'} is not on the allow-list`);
    }

    return this.wrong(ctx, settings, variable, location);
  }

  /** Not what was asked for: say so and wait again, or give up once the retries are used. */
  private async wrong(
    ctx: NodeContext,
    settings: AskWaitSettings,
    variable: string,
    location: boolean,
  ): Promise<CustomDecision> {
    const attempts = num(ctx.run.wait?.data?.attempts, 0) + 1;
    if (attempts <= settings.maxRetries) {
      const out = await ctx.send({ kind: 'text', body: ctx.render(settings.wrongReplyText) });
      if (!out.ok) ctx.note(`the wrong-reply message was not sent: ${out.error}`);
      return { action: 'stay', data: { attempts } };
    }
    if (settings.onGiveUp === 'end') {
      ctx.note('retries used up: the run ended');
      return { action: 'end', reason: 'end_node' };
    }
    ctx.note('retries used up: moved on without an answer');
    return {
      action: 'route',
      port: 1,
      setVars: { ...this.emptyVars(variable, location), ...status(variable, 'failed') },
    };
  }

  private emptyVars(variable: string, location: boolean): Record<string, unknown> {
    const suffixes = location
      ? ['latitude', 'longitude', 'name', 'address', 'link']
      : ['url', 'kind', 'name', 'mime', 'caption'];
    return { [variable]: '', ...Object.fromEntries(suffixes.map((s) => [`${variable}_${s}`, ''])) };
  }

  /** "Save the response as property": the file link goes into one of the contact's own properties. A failure never stops the flow. */
  private async saveProperty(ctx: NodeContext, key: string, url: string): Promise<void> {
    if (key === '' || url === '') return;
    if (ctx.run.contactId === null) {
      ctx.note('this run has no contact to save the file on: skipped');
      return;
    }
    try {
      const done = await this.contacts.setPropertyFromFlow(
        ctx.run.orgId,
        ctx.run.contactId,
        key,
        url,
      );
      ctx.note(
        done ? `file link saved on the contact property "${key}"` : `no contact property "${key}"`,
      );
    } catch (err) {
      this.logger.warn({ err }, '[FLR] saving the file on a contact property failed');
      ctx.note(`the contact property could not be saved: ${(err as Error).message}`);
    }
  }

  private sendFailed(out: Extract<SendOutcome, { ok: false }>, ctx: NodeContext): NodeResult {
    if (out.halt) return { kind: 'halt', reason: out.error };
    ctx.note(`send failed: ${out.error}`);
    return { kind: 'fail', code: out.code, reason: out.error };
  }
}
