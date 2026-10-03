import { Injectable } from '@nestjs/common';
import type { CustomDecision, InboundReply, NodeContext, NodeResult } from '../../types';
import { sendFailed, str } from './send-failure';
import { flattenAnswer, formToken, WaFormRecords } from './wa-form-records';

const HANDLER = 'WaForm';
const advance: NodeResult = { kind: 'advance', port: 1 };

/** Channels that can open a WhatsApp Form: the Cloud API (and the simulator that stands in for it). */
const FORM_CHANNELS: ReadonlySet<string> = new Set(['whatsapp_cloud', 'simulator']);

/**
 * The WhatsApp Form node (TW-FLR-043): sends a published form as a Meta flow message (a button that opens the form inside WhatsApp)
 * and waits. The customer's submission comes back as an outside event (`FlowEngine.deliverExternal`, see `CommerceResume`): every
 * answer is stored in the run's variables under its field id and under `form_<field id>`, and the run leaves by its only port.
 *
 * Like Reference, a form that is not set up, not published, or sent on a channel that cannot open one is noted and skipped, and so is a
 * send that is refused. (A channel that is down halts the run instead; it tries again by itself.) The flow token carries the form
 * and this run, so a submission finds its run and no other.
 */
@Injectable()
export class FormNode {
  constructor(private readonly forms: WaFormRecords) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const p = ctx.node.props;
    const ref = str(p.formId);
    if (ref === '') {
      ctx.note('no form chosen: skipped');
      return advance;
    }
    if (!FORM_CHANNELS.has(ctx.run.channelKind ?? '')) {
      ctx.note('forms open only in WhatsApp (Cloud API): skipped');
      return advance;
    }
    let form;
    try {
      form = await this.forms.liveForm(ctx.run.orgId, ref);
    } catch (err) {
      ctx.note(`the form could not be read: ${err instanceof Error ? err.message : 'error'}`);
      return advance;
    }
    if (!form) {
      ctx.note('the form is not published (or not in this workspace): skipped');
      return advance;
    }

    const flowToken = formToken(form.id, ctx.run.uuid);
    const out = await ctx.send({
      kind: 'form',
      body: ctx.render(str(p.bodyText) || 'Please tap below to fill out our form.'),
      flowId: form.metaFlowId,
      flowToken,
      cta: str(p.ctaLabel) || 'Open form',
    });
    if (!out.ok) return sendFailed(out, 'skip', ctx) ?? advance;

    return {
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable: 'form_submission',
        kind: 'Custom',
        handler: HANDLER,
        data: {
          formId: form.id,
          flowToken,
          flowVariable: str(p.flowVariable) || 'form_submission',
        },
      },
    };
  }

  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    // Typing while the form is open is not an answer: forms are resumed by their submission only.
    if (reply.kind !== 'external') return { action: 'ignore' };
    const data = ctx.run.wait?.data ?? {};
    const answers = (reply.data?.answers ?? {}) as Record<string, unknown>;
    const setVars: Record<string, unknown> = {};
    const flat: Record<string, string> = {};
    // Under the bare field id and under `form_` + the id, so a flow can use {{name}} or {{form_name}}.
    for (const [k, v] of Object.entries(answers)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const text = flattenAnswer(v);
      flat[k] = text;
      setVars[k] = text;
      setVars[`form_${k}`] = text;
    }
    const into = str(data.flowVariable);
    if (into !== '') setVars[into] = flat;
    return { action: 'route', port: 1, setVars };
  }
}
