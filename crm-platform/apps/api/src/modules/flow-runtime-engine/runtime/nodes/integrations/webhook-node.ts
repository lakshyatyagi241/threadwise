import type { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import type { NodeContext, NodeResult } from '../../types';
import { flattenInto, interpolate } from '../../variables';

const TIMEOUT_MS = 15_000;
/** WaDesk capped a response and a request body at 5 MB. */
const MAX_BYTES = 5 * 1024 * 1024;

export const str = (v: unknown, d = ''): string =>
  v === undefined || v === null || typeof v === 'object' ? d : String(v);
export const dataOf = (ctx: NodeContext): Record<string, unknown> => {
  const d = ctx.node.props.data;
  return d !== null && typeof d === 'object' ? (d as Record<string, unknown>) : {};
};

/** The body of a JSON webhook: as typed, else with every variable JSON-escaped (a multi-line order), else the raw text (WaDesk). */
function jsonBody(ctx: NodeContext, template: string): unknown {
  const raw = ctx.render(template);
  try {
    return raw === '' ? {} : JSON.parse(raw);
  } catch {
    try {
      const safe = interpolate(template, ctx.run.vars, { escape: 'json' });
      return safe === '' ? {} : JSON.parse(safe);
    } catch {
      return raw;
    }
  }
}

/**
 * Webhook node (WD-FLR-032): one outbound HTTP request through the guarded SafeFetch, the response saved under the node's variable
 * (whole text, then every field as a dotted key), and out by the single port whatever happened: a refused host, a timeout or a
 * non-2xx leaves the variable empty and the flow continues, exactly as WaDesk did. No retry (the step itself is not repeated on
 * a failed call, the next node simply runs).
 */
export async function runWebhook(ctx: NodeContext, safeFetch: SafeFetch): Promise<NodeResult> {
  const d = dataOf(ctx);
  const method = str(d.method, 'POST').toUpperCase();
  const url = ctx.render(d.url).trim();
  const contentType = str(d.contentType, 'application/json');
  const saveAs = str(d.variable, 'response');
  if (url === '') {
    ctx.note('webhook has no URL: skipped');
    return { kind: 'advance', port: 1 };
  }

  // The step can run twice if its write loses the compare-and-set: a receiver that honours the key sees one event.
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Idempotency-Key': ctx.stepKey,
  };
  if (Array.isArray(d.headers)) {
    for (const h of d.headers as Array<Record<string, unknown>>) {
      const k = str(h?.key).trim();
      if (k !== '') headers[k] = ctx.render(h?.value);
    }
  }

  let payload: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const template = str(d.body);
    if (contentType.includes('json')) {
      const body = jsonBody(ctx, template);
      if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        // A context envelope so the receiver knows who triggered it; the author's own `_wadesk` wins key by key.
        const v = ctx.run.vars;
        const record = body as Record<string, unknown>;
        record._wadesk = {
          customer_phone: ctx.run.peerKey,
          wa_id: ctx.run.peerKey,
          name: str(v.name ?? v.pushName),
          first_name: str(v.first_name),
          push_name: str(v.pushName),
          device_phone: '',
          waba_id: '',
          phone_number_id: '',
          conversation_id: ctx.run.conversationId,
          flow_id: ctx.run.flowId,
          ...(record._wadesk !== null && typeof record._wadesk === 'object'
            ? (record._wadesk as object)
            : {}),
        };
      }
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    } else {
      payload = ctx.render(template);
    }
    if (payload !== undefined && Buffer.byteLength(payload) > MAX_BYTES) {
      ctx.run.vars[saveAs] = '';
      ctx.note('webhook body is larger than 5 MB: not sent');
      return { kind: 'advance', port: 1 };
    }
    headers['Content-Length'] = String(Buffer.byteLength(payload ?? ''));
  }

  try {
    const res = await safeFetch.request(url, {
      method,
      headers,
      body: payload,
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
    });
    if (res.status < 200 || res.status >= 300) {
      ctx.note(`webhook ${method} answered HTTP ${res.status}: ${res.text.slice(0, 200)}`);
      ctx.run.vars[saveAs] = '';
      return { kind: 'advance', port: 1 };
    }
    let parsed: unknown = res.text;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      /* plain text */
    }
    ctx.run.vars[saveAs] = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    if (parsed !== null && typeof parsed === 'object') {
      flattenInto(ctx.run.vars, saveAs, parsed);
      // Opt-in: an endpoint can hand the flow the customer's real text (a transcribed voice order) for the nodes after it.
      const set = (parsed as Record<string, unknown>).set_user_message;
      if (typeof set === 'string' && set.trim() !== '') ctx.run.vars.user_message = set;
    }
  } catch (e) {
    ctx.note(`webhook ${method} failed: ${e instanceof Error ? e.message : String(e)}`);
    ctx.run.vars[saveAs] = '';
  }
  return { kind: 'advance', port: 1 };
}
