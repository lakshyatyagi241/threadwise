import type { LocalDiskMediaStore } from '../../../infra/providers/chat-conversations/media/local-disk-media.store';

/** The slice of a `pg` client the seed uses (a `Client` or a `PoolClient`). */
export interface SeedClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export interface SeedCallsOptions {
  /** How many calls to make. Default 60. */
  count?: number;
  /** The instant "now" is. Default the current time; the calls spread over the 30 days before it. */
  now?: Date;
  /** Where the sample recordings go (the chat media store's local directory). Omit for calls without a recording. */
  store?: Pick<LocalDiskMediaStore, 'put'>;
}

export interface SeedCallsResult {
  created: number;
  existing: number;
  recordings: number;
  numberId: number;
}

/** Deterministic pseudo-random numbers, so running the seed twice makes the same calls (and the second run adds nothing). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A short sine tone as a WAV file (8 kHz, mono, 16 bit): a recording that really plays, for the demo. */
export function toneWav(seconds: number, hz: number): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 400, (samples - i) / 400);
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 9000 * fade), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/**
 * Sample calls for a workspace, so the call log, a call and the analytics can be shown without a WhatsApp number or a microphone
 * (dev only; a script, never a migration). Idempotent: every call carries a Meta call id of its own (`demo.<org>.<n>`), and one that
 * exists is left alone. It uses the workspace's WhatsApp Cloud API number when it has one and otherwise makes a disconnected "Demo
 * line" (no credentials, calling off), the people of the workspace as the handlers, and its contacts when it has any.
 */
export async function seedDemoCalls(
  db: SeedClient,
  orgId: number,
  opts: SeedCallsOptions = {},
): Promise<SeedCallsResult> {
  const count = opts.count ?? 60;
  const now = opts.now ?? new Date();
  const rand = lcg(orgId * 7919 + 17);

  let cfg = (
    await db.query(
      `SELECT id, phone_number FROM wa_provider_configs WHERE org_id = $1 AND provider = 'waba' ORDER BY is_primary DESC, id LIMIT 1`,
      [orgId],
    )
  ).rows[0];
  if (!cfg) {
    cfg = (
      await db.query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, meta_json)
         VALUES ($1, 'waba', 'disconnected', '+14155550100', 'Demo line', '{"demo":true}'::jsonb)
         RETURNING id, phone_number`,
        [orgId],
      )
    ).rows[0]!;
  }
  const ours = String(cfg.phone_number ?? '14155550100').replace(/\D/g, '');

  const handlers = (
    await db.query(
      `SELECT id FROM users WHERE org_id = $1 AND status = 'active' ORDER BY id LIMIT 4`,
      [orgId],
    )
  ).rows.map((r) => Number(r.id));
  const contacts = (
    await db.query(
      `SELECT id, normalized_phone FROM contacts WHERE org_id = $1 AND normalized_phone IS NOT NULL ORDER BY id LIMIT 8`,
      [orgId],
    )
  ).rows.map((r) => ({ id: Number(r.id), phone: String(r.normalized_phone).replace(/\D/g, '') }));

  let created = 0;
  let recordings = 0;
  for (let i = 0; i < count; i++) {
    const metaCallId = `demo.${orgId}.${i}`;
    const kind = i % 10;
    const inbound = i % 3 !== 0;
    const contact = contacts.length ? contacts[i % contacts.length] : undefined;
    const customer = contact?.phone ?? `91981110${String(1000 + (i % 40))}`;
    // Calls cluster in working hours of the last 30 days, newest first as i grows... oldest last.
    const daysAgo = Math.floor((i / count) * 29);
    const startedAt = new Date(now.getTime() - daysAgo * 86_400_000);
    startedAt.setUTCHours(
      9 + Math.floor(rand() * 9),
      Math.floor(rand() * 60),
      Math.floor(rand() * 60),
      0,
    );
    if (startedAt > now) startedAt.setTime(now.getTime() - (i + 1) * 60_000);

    let status = 'ended';
    let duration = 0;
    let endReason: string | null = 'NO_ANSWER';
    let handled = false;
    if (kind <= 4 || kind === 9) {
      duration = 25 + Math.floor(rand() * 560);
      endReason = 'COMPLETED';
      handled = true;
    } else if (kind === 5) {
      endReason = inbound ? 'REJECTED' : 'NO_ANSWER';
      handled = inbound;
    } else if (kind === 8) {
      status = 'failed';
      endReason = 'NO_PERMISSION';
      handled = true;
    }
    const handler = handled && handlers.length ? handlers[i % handlers.length] : null;
    const answeredAt = duration > 0 ? new Date(startedAt.getTime() + 6_000) : null;
    const endedAt = new Date(startedAt.getTime() + (duration > 0 ? duration + 6 : 25) * 1000);

    let recordingPath: string | null = null;
    if (opts.store && duration > 0 && kind % 2 === 0) {
      recordingPath = `chat/${orgId}/calls/demo-call-${i}.wav`;
    }

    const ins = await db.query(
      `INSERT INTO wa_calls (org_id, provider, wa_provider_config_id, meta_call_id, direction, from_phone, to_phone, contact_id,
                             status, handler_type, handler_user_id, started_at, answered_at, ended_at, duration_sec, end_reason,
                             recording_path)
       VALUES ($1, 'waba', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (meta_call_id) DO NOTHING
       RETURNING id`,
      [
        orgId,
        cfg.id,
        metaCallId,
        inbound ? 'USER_INITIATED' : 'BUSINESS_INITIATED',
        inbound ? customer : ours,
        inbound ? ours : customer,
        contact?.id ?? null,
        status,
        handler ? 'operator' : 'none',
        handler,
        startedAt.toISOString(),
        answeredAt?.toISOString() ?? null,
        endedAt.toISOString(),
        duration,
        endReason,
        recordingPath,
      ],
    );
    const callId = ins.rows[0]?.id;
    if (callId === undefined) continue;
    created++;

    const step = (type: string, offsetSec: number, payload: Record<string, unknown>) =>
      db.query(
        `INSERT INTO wa_call_events (org_id, wa_call_id, event_type, payload, received_at) VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          orgId,
          callId,
          type,
          JSON.stringify(payload),
          new Date(startedAt.getTime() + offsetSec * 1000).toISOString(),
        ],
      );
    if (inbound) {
      await step('connect', 0, { id: metaCallId });
      if (handler && status !== 'failed') {
        await step('pre_accept_sent', 3, {});
        if (duration > 0) await step('accept_sent', 4, {});
        else await step('reject_sent', 4, { reason: 'REJECTED' });
      }
    } else {
      await step('dial_sent', 0, {});
      if (status === 'failed')
        await step('dial_failed', 1, { message: 'No approved call permission' });
      else await step('connect', 2, { id: metaCallId });
    }
    if (status !== 'failed')
      await step('terminate', duration > 0 ? duration + 6 : 25, { status: endReason });

    if (recordingPath && opts.store) {
      const wav = toneWav(3, 330 + (i % 5) * 70);
      await opts.store.put(recordingPath, wav);
      await step('recording_stored', duration + 7, { size: wav.length, mime: 'audio/wav' });
      recordings++;
    }
  }
  return { created, existing: count - created, recordings, numberId: Number(cfg.id) };
}
