import { Injectable } from '@nestjs/common';
import { TemplatesService } from '../../../../message-templates';
import { FlowRefResolver, parseFlowRef } from '../flow-refs';
import type { CustomDecision, InboundReply, NodeContext, NodeResult } from '../../types';
import { sendFailed, str } from './send-failure';
import {
  quickReplies,
  richComponents,
  templateComponents,
  templateText,
  templateValues,
  withOverrides,
} from './template-rules';

const advance: NodeResult = { kind: 'advance', port: 1 };

/** The exit a template's status leaves by (the buttons take 1, 2, ...; see `PORT_MAP` in the compiler). */
export const TEMPLATE_STATUS_PORT: Readonly<Record<string, number>> = {
  sent: 101,
  delivered: 102,
  read: 103,
  replied: 104,
  failed: 105,
};
const lc = (s: string): string => s.trim().toLowerCase();

/**
 * The Template node (TW-FLR-026): sends an approved WhatsApp template picked by id or name from this workspace, which is what lets a
 * flow open a conversation outside the 24 hour window (the dispatcher lets a template through a closed window). A template that is
 * missing or not approved is noted and skipped, as Reference skipped one it could not find, rather than blasting the customer with
 * something else. Channels without templates get the template's text. When the author wired the quick-reply buttons to branches the
 * node waits for the tap (a menu that stays open unless `keepMenuOpen` is off); otherwise it moves on.
 *
 * Status exits (Sent, Delivered, Read, Replied, Failed): with them on and a branch wired, the node does not move on at once. `sent` is
 * taken as soon as the template is accepted, `failed` when it is not; for the others the run waits (a `Custom` wait) and leaves by the
 * FIRST wired exit that happens: the provider's delivered / read receipt, a tap on a button, or any other message from the customer
 * (`replied`). A run can leave a node only once, so a later status is not acted on.
 */
@Injectable()
export class TemplateNode {
  constructor(
    private readonly templates: TemplatesService,
    private readonly refs: FlowRefResolver,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const p = ctx.node.props;
    const name = str(p.templateName);
    let id = Number(p.templateId) || 0;
    // The editor saves the template's uuid: resolved inside this workspace only (another workspace's uuid is no template here).
    const uuid = parseFlowRef(p.templateUuid);
    if (id === 0 && uuid) {
      try {
        id = await this.refs.templateId(ctx.run.orgId, uuid);
      } catch (err) {
        ctx.note(
          `the template id could not be resolved: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
    if (name === '' && id === 0) {
      ctx.note(
        uuid
          ? 'the chosen template is not in this workspace: skipped'
          : 'no template chosen: moving on',
      );
      return advance;
    }
    let tpl;
    try {
      tpl = await this.templates.findForFlow(ctx.run.orgId, { id, name });
    } catch (err) {
      ctx.note(`the template could not be read: ${err instanceof Error ? err.message : 'error'}`);
      return advance;
    }
    if (!tpl) {
      ctx.note(`template "${name || id}" is not in this workspace: skipped`);
      return advance;
    }
    if (tpl.status !== 'approved') {
      ctx.note(`template "${tpl.name}" is ${tpl.status}, not approved: skipped`);
      return advance;
    }

    // The author's own fills for placeholders and the header file win over what the template maps.
    const mine = withOverrides(
      tpl,
      (p.variableOverrides ?? {}) as Record<string, string>,
      str(p.headerMediaUrl),
      ctx.render,
    );
    const header = templateValues(mine.tpl, 'header', mine.render);
    const body = templateValues(mine.tpl, 'body', mine.render);
    const text = templateText(tpl, header, body);
    const buttons = quickReplies(tpl, ctx.node.id);
    const wired = p.buttonsWired === true && buttons.length > 0;
    const components =
      richComponents(mine.tpl, mine.render) ?? templateComponents(tpl, header, body);

    const out = await ctx.send({
      kind: 'template',
      name: tpl.name,
      language: tpl.language,
      variables: body,
      ...(components ? { components } : {}),
      text,
      ...(buttons.length > 0 ? { buttons } : {}),
    });
    const statuses = (Array.isArray(p.statusWired) ? p.statusWired : []).filter(
      (s): s is string => typeof s === 'string' && s in TEMPLATE_STATUS_PORT,
    );
    if (!out.ok) {
      // The author wired "Failed": the flow goes on that way (a channel that is down still halts the run, as for every send).
      if (statuses.includes('failed') && !out.halt) {
        ctx.note(`the template did not go out (${out.error}): left by Failed`);
        return { kind: 'advance', port: TEMPLATE_STATUS_PORT.failed! };
      }
      // A tap nobody can make would strand the run: with branches wired, a template that did not go out ends it.
      return sendFailed(out, wired ? 'end' : 'skip', ctx) ?? advance;
    }
    ctx.run.lastOut = { kind: 'text', text, url: '', caption: '', filename: null };

    if (statuses.includes('sent')) return { kind: 'advance', port: TEMPLATE_STATUS_PORT.sent! };
    const waitFor = statuses.filter((s) => s !== 'sent' && s !== 'failed');
    if (waitFor.length > 0 || (statuses.includes('failed') && statuses.length > 0)) {
      return {
        kind: 'wait',
        wait: {
          nodeId: ctx.node.id,
          variable: 'user_message',
          kind: 'Custom',
          handler: 'Template',
          data: {
            templateId: tpl.id,
            templateName: tpl.name,
            statuses,
            since: ctx.now().toISOString(),
            buttons: wired ? buttons : [],
          },
        },
      };
    }

    if (!wired) return advance;
    const variable = 'user_message';
    ctx.run.menus.byNode[ctx.node.id] = buttons;
    // The latest menu is what a branch that runs out of nodes re-arms: a one-shot template does not offer itself again.
    if (p.keepMenuOpen !== false) {
      ctx.run.menus.latest = { nodeId: ctx.node.id, variable, answerItems: buttons };
    }
    return {
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable,
        kind: 'Question',
        answerItems: buttons,
        persistent: p.keepMenuOpen !== false,
      },
    };
  }

  /**
   * What happens while the run waits on a template with status exits: the provider's receipt arrives as an outside event
   * (`{ status }`), a tap on one of its buttons or a typed button label takes that button's exit, and any other message from the
   * customer is a reply. An event or a message the author did not wire an exit for is not an answer: the run keeps waiting.
   */
  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    const d = (ctx.run.wait?.data ?? {}) as {
      statuses?: string[];
      buttons?: Array<{ id: string; text: string }>;
    };
    const statuses = d.statuses ?? [];
    if (reply.kind === 'external') {
      const status = String(reply.data?.status ?? '');
      const port = TEMPLATE_STATUS_PORT[status];
      return port !== undefined && statuses.includes(status)
        ? { action: 'route', port }
        : { action: 'ignore' };
    }
    const buttons = d.buttons ?? [];
    const i = buttons.findIndex(
      (b) =>
        (reply.id !== '' && reply.id === b.id) ||
        (reply.text !== '' && lc(reply.text) === lc(b.text)),
    );
    if (i >= 0)
      return { action: 'route', port: i + 1, setVars: { user_message: buttons[i]!.text } };
    if (statuses.includes('replied'))
      return {
        action: 'route',
        port: TEMPLATE_STATUS_PORT.replied!,
        setVars: { user_message: reply.text },
      };
    return { action: 'ignore' };
  }
}
