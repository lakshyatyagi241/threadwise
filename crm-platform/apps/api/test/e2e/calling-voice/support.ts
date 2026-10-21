import {
  updateCallRecordingSettingsInputSchema,
  type UpdateCallRecordingSettingsInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { CallRecordingSettingsService } from '../../../src/modules/calling-voice/call-recording-settings.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

export { Api, type Tenant };

/**
 * WhatsApp calling end to end: the real API, the WABA webhook's worker side bound to the calling domain, real Postgres (restricted
 * role) and Redis. Meta is a fake behind the one HTTP client every Graph call goes through, so a spec sees exactly what would have
 * been sent and decides what Meta answers.
 */
export interface CallPipeline {
  h: Harness;
  api: Api;
  meta: FakeMeta;
  stop(): Promise<void>;
}

export interface MetaRequest {
  method: string;
  url: string;
  path: string;
  body: Record<string, unknown>;
  auth: string | null;
}

type Responder = (req: MetaRequest) => { status?: number; json?: unknown } | undefined;

export class FakeMeta {
  readonly requests: MetaRequest[] = [];
  private readonly responders: Responder[] = [];

  /** The first responder that answers wins; with none, Meta says `{ success: true }`. Newest first, so a spec can override. */
  answer(fn: Responder): void {
    this.responders.unshift(fn);
  }
  reset(): void {
    this.requests.length = 0;
    this.responders.length = 0;
  }
  /** Requests to `.../calls` with this action. */
  action(action: string): MetaRequest[] {
    return this.requests.filter((r) => r.path.endsWith('/calls') && r.body.action === action);
  }
  messages(): MetaRequest[] {
    return this.requests.filter((r) => r.path.endsWith('/messages'));
  }
  settings(): MetaRequest[] {
    return this.requests.filter((r) => r.path.endsWith('/settings'));
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const req: MetaRequest = {
      method: String(init?.method ?? 'GET'),
      url: input,
      path: u.pathname.replace(/^\/v[\d.]+/, ''),
      // The app-subscription call is multipart; read its fields as a plain object.
      body:
        init?.body instanceof FormData
          ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, String(v)]))
          : init?.body
            ? (JSON.parse(String(init.body)) as Record<string, unknown>)
            : {},
      auth: headers.authorization ?? null,
    };
    this.requests.push(req);
    for (const r of this.responders) {
      const out = r(req);
      if (out) return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
}

export const metaError = (code: number, message: string, status = 400) => ({
  status,
  json: { error: { message, code, type: 'OAuthException' } },
});

export async function startCallPipeline(): Promise<CallPipeline> {
  const h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/calling-voice')).CallingVoiceWorkerModule,
    ],
  });
  const { WabaHttp } =
    await import('../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http');
  const meta = new FakeMeta();
  h.app.get(WabaHttp, { strict: false }).fetchImpl = meta.fetch;
  await h.app.listen(0, '127.0.0.1');
  return { h, api: new Api(h), meta, stop: () => h.stop() };
}

// --- arranging ---------------------------------------------------------------------------------------------------------------

export interface CallNumber {
  configId: number;
  uuid: string;
  phoneNumberId: string;
  wabaId: string;
  phone: string;
}

let n = 0;

/** A connected WhatsApp number with credentials, the way the WABA domain stores one. */
export async function addNumber(
  p: CallPipeline,
  t: Tenant,
  o: { calling?: boolean; meta?: Record<string, unknown>; phone?: string } = {},
): Promise<CallNumber> {
  const { CryptoService } = await import('../../../src/common/crypto/crypto.service');
  const crypto = p.h.app.get(CryptoService, { strict: false });
  const phoneNumberId = `10${Date.now()}${n++}`.slice(0, 15);
  const wabaId = `88${phoneNumberId}`;
  const phone = o.phone ?? `+9199${String(10000000 + n).slice(0, 8)}`;
  const row = await p.h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, credentials_json, meta_json,
                                      connected_at, calling_enabled, calling_enabled_at)
     VALUES ($1, 'waba', 'connected', $2, 'Support line', $3, $4::jsonb, now(), $5, CASE WHEN $5 THEN now() END)
     RETURNING id, uuid`,
    [
      t.orgId,
      phone,
      crypto.encrypt(JSON.stringify({ access_token: 'tok-' + phoneNumberId })),
      JSON.stringify({
        provider: 'meta',
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        ...(o.meta ?? {}),
      }),
      o.calling ?? true,
    ],
  );
  return {
    configId: Number(row.rows[0].id),
    uuid: String(row.rows[0].uuid),
    phoneNumberId,
    wabaId,
    phone,
  };
}

/** Meta's `calls` webhook value for one event, as the WABA domain hands it to the calling domain. */
export function callsValue(number: CallNumber, call: Record<string, unknown>) {
  return {
    messaging_product: 'whatsapp',
    metadata: {
      display_phone_number: number.phone.replace(/\D/g, ''),
      phone_number_id: number.phoneNumberId,
    },
    calls: [call],
  };
}

/** Delivers a `calls` webhook the way Meta would, through the WABA domain's own ingest (route lookup, sink binding and all). */
export async function deliver(
  p: CallPipeline,
  number: CallNumber,
  call: Record<string, unknown>,
): Promise<void> {
  const { WabaIngestService } =
    await import('../../../src/modules/whatsapp-cloud-api-waba/waba-ingest.service');
  const { splitWebhook } = await import('../../../src/modules/whatsapp-cloud-api-waba/waba-rules');
  const changes = splitWebhook({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: number.wabaId,
        time: Math.floor(Date.now() / 1000),
        changes: [{ field: 'calls', value: callsValue(number, call) }],
      },
    ],
  });
  await p.h.app.get(WabaIngestService, { strict: false }).process(changes);
}

export const SDP_OFFER = `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n`;
export const SDP_ANSWER = SDP_OFFER.replace('o=- 1 2', 'o=- 3 4');

export const callRow = async (p: CallPipeline, uuid: string) =>
  (await p.h.owner.query(`SELECT * FROM wa_calls WHERE uuid = $1`, [uuid])).rows[0] as
    Record<string, unknown> | undefined;

export const events = async (p: CallPipeline, callId: number) =>
  (
    await p.h.owner.query(
      `SELECT event_type FROM wa_call_events WHERE wa_call_id = $1 ORDER BY id`,
      [callId],
    )
  ).rows.map((r) => String(r.event_type));

// --- call recording consent (BL-144) -----------------------------------------------------------------------------------------

export const RECORDING_NOTICE = 'This call may be recorded to check quality and to train our team.';

/**
 * Saves the workspace's recording rules through the real service, after the schema the PUT route validates with. The route needs
 * `call.recordings.manage`, which no role holds any more (WhatsApp calling removed), so the rules are saved here without the route. The
 * service keeps the notice-required check, the notice version, the sha-256 and the audit row.
 */
export async function saveRecordingRules(
  p: CallPipeline,
  t: Tenant,
  input: UpdateCallRecordingSettingsInput,
) {
  const settings = p.h.app.get(CallRecordingSettingsService, { strict: false });
  return RequestContextStore.run(
    {
      requestId: 'e2e',
      orgId: t.orgId,
      actorType: 'user',
      actorId: t.adminUserId,
      userId: t.adminUserId,
    },
    async () => {
      const current = await settings.get();
      return settings.update(
        updateCallRecordingSettingsInputSchema.parse({
          ...input,
          ...(current.rowVersion ? { rowVersion: current.rowVersion } : {}),
        }),
      );
    },
  );
}

/** Switches recording on for the workspace (see saveRecordingRules). */
export async function enableRecording(
  p: CallPipeline,
  t: Tenant,
  o: { mode?: 'announcement' | 'confirmed'; retentionDays?: number; notice?: string } = {},
) {
  const saved = await saveRecordingRules(p, t, {
    enabled: true,
    consentMode: o.mode ?? 'confirmed',
    retentionDays: o.retentionDays ?? 90,
    noticeText: o.notice ?? RECORDING_NOTICE,
  });
  return { noticeVersion: saved.noticeVersion, rowVersion: saved.rowVersion };
}
