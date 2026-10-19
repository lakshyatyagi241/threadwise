import { Injectable } from '@nestjs/common';
import { authOf, type WabaConnection } from '../whatsapp-cloud-api-waba/waba-admin.port';
import { WabaHttp } from '../whatsapp-cloud-api-waba/waba-http';
import type {
  CallAction,
  CallActionParams,
  CallingGraph,
  CallingSettingsRead,
} from './calling-graph.port';

const TIMEOUT_MS = 15_000;

/** The calling adapter over Meta's Graph API, through the shared WhatsApp HTTP client (version, auth, timeout, error shape). */
@Injectable()
export class CallingGraphClient implements CallingGraph {
  constructor(private readonly http: WabaHttp) {}

  async getSettings(conn: WabaConnection): Promise<CallingSettingsRead> {
    const body = await this.http.call<{
      calling?: { status?: unknown; call_icon_visibility?: unknown };
    }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.phoneNumberId}/settings`,
      timeoutMs: TIMEOUT_MS,
    });
    const status = String(body.calling?.status ?? '').toUpperCase();
    const icon = body.calling?.call_icon_visibility;
    return {
      status: status === 'ENABLED' || status === 'DISABLED' ? status : null,
      callIconVisibility: typeof icon === 'string' && icon !== '' ? icon : null,
    };
  }

  setCalling(conn: WabaConnection, enabled: boolean): Promise<Record<string, unknown>> {
    return this.http.call(authOf(conn), {
      method: 'POST',
      path: `/${conn.phoneNumberId}/settings`,
      json: { calling: { status: enabled ? 'ENABLED' : 'DISABLED' } },
      timeoutMs: TIMEOUT_MS,
    });
  }

  requestPermission(
    conn: WabaConnection,
    to: string,
    body: string,
  ): Promise<Record<string, unknown>> {
    return this.http.call(authOf(conn), {
      method: 'POST',
      path: `/${conn.phoneNumberId}/messages`,
      json: {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'call_permission_request',
          // Meta answers 400 "missing action" without this.
          action: { name: 'call_permission_request' },
          body: { text: body },
        },
      },
      timeoutMs: TIMEOUT_MS,
    });
  }

  callAction(
    conn: WabaConnection,
    action: CallAction,
    p: CallActionParams,
  ): Promise<Record<string, unknown>> {
    const json: Record<string, unknown> = { messaging_product: 'whatsapp', action };
    if (p.to) json.to = p.to;
    if (p.callId) json.call_id = p.callId;
    if (p.sdp) json.session = { sdp_type: p.sdp.type, sdp: p.sdp.sdp };
    if (p.opaque) json.biz_opaque_callback_data = p.opaque;
    if (p.reason) json.reason = p.reason;
    return this.http.call(authOf(conn), {
      method: 'POST',
      path: `/${conn.phoneNumberId}/calls`,
      json,
      timeoutMs: TIMEOUT_MS,
    });
  }
}
