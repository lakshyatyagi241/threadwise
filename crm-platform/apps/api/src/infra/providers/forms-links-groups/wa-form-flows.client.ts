import { Injectable } from '@nestjs/common';
import type { WabaConnection } from '../whatsapp-cloud-api-waba/waba-admin.port';
import { WabaHttp } from '../whatsapp-cloud-api-waba/waba-http';
import type { FlowAssetValidationError, WaFormFlowsPort } from './wa-form-flows.port';

interface RawValidationError {
  error?: string;
  message?: string;
  line?: number;
}

/**
 * Meta Graph adapter — see `WaFormFlowsPort` for the contract and why it is a port.
 *
 * WhatsApp Flow management (`/flows`, `/{flowId}/assets`, `/{flowId}/publish`) is a Meta-Graph-only, account-level
 * API: it is not part of the Cloud-API-compatible surface a BSP proxy (Interakt) or a third-party registry provider
 * implements. Every call here goes through `WabaHttp.graph()` (always `graph.facebook.com`, never the connection's
 * own route) and `requireMetaBearer` refuses up front for anything else — better a clear refusal than silently
 * sending the form's Flow JSON to the wrong host. Mirrors `waba-template.client.ts`'s handling of the same class of
 * Meta-only, non-Cloud-API endpoint.
 */
@Injectable()
export class WaFormFlowsClient implements WaFormFlowsPort {
  constructor(private readonly http: WabaHttp) {}

  async ensureFlow(
    conn: WabaConnection,
    existingFlowId: string | null,
    input: { name: string; categories: string[] },
  ): Promise<{ flowId: string }> {
    if (existingFlowId) return { flowId: existingFlowId };
    const bearer = requireMetaBearer(conn);
    const res = await this.http.graph<{ id?: string }>(bearer, {
      method: 'POST',
      path: `/${conn.wabaId}/flows`,
      json: { name: input.name, categories: input.categories },
    });
    return { flowId: String(res.id ?? '') };
  }

  async uploadFlowJson(
    conn: WabaConnection,
    flowId: string,
    flowJson: object,
  ): Promise<{ validationErrors: FlowAssetValidationError[] }> {
    const bearer = requireMetaBearer(conn);
    const form = new FormData();
    form.append('asset_type', 'FLOW_JSON');
    form.append('name', 'flow.json');
    form.append(
      'file',
      new Blob([JSON.stringify(flowJson)], { type: 'application/json' }),
      'flow.json',
    );
    const res = await this.http.graph<{ validation_errors?: RawValidationError[] }>(bearer, {
      method: 'POST',
      path: `/${flowId}/assets`,
      form,
    });
    const errors = (res.validation_errors ?? []).map((e) => ({
      error: e.error ?? 'VALIDATION_ERROR',
      message: e.message ?? 'Meta rejected the form definition.',
      line: e.line,
    }));
    return { validationErrors: errors };
  }

  async publish(conn: WabaConnection, flowId: string): Promise<void> {
    const bearer = requireMetaBearer(conn);
    await this.http.graph(bearer, { method: 'POST', path: `/${flowId}/publish`, json: {} });
  }
}

function requireMetaBearer(conn: WabaConnection): string {
  if (conn.registry || conn.provider !== 'meta' || !conn.accessToken) {
    throw new Error('WhatsApp Forms needs a direct Meta Cloud API connection (Flow management is Meta-only).');
  }
  return conn.accessToken;
}
