import { Injectable } from '@nestjs/common';
import { TemplatesService } from '../../../../message-templates';
import { FlowRefResolver, parseFlowRef } from '../flow-refs';
import type { NodeContext, NodeResult } from '../../types';
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

/**
 * The Template node (TW-FLR-026): sends an approved WhatsApp template picked by id or name from this workspace, which is what lets a
 * flow open a conversation outside the 24 hour window (the dispatcher lets a template through a closed window). A template that is
 * missing or not approved is noted and skipped, as Reference skipped one it could not find, rather than blasting the customer with
 * something else. Channels without templates get the template's text. When the author wired the quick-reply buttons to branches the
 * node waits for the tap (a menu that stays open unless `keepMenuOpen` is off); otherwise it moves on.
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
    if (!out.ok) {
      // A tap nobody can make would strand the run: with branches wired, a template that did not go out ends it.
      return sendFailed(out, wired ? 'end' : 'skip', ctx) ?? advance;
    }
    ctx.run.lastOut = { kind: 'text', text, url: '', caption: '', filename: null };

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
}
