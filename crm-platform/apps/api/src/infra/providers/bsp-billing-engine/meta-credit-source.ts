import { Injectable, Logger } from '@nestjs/common';
import type {
  CreditSourceConnection,
  CreditSourcePort,
  CreditSourceResult,
} from './credit-source.port';

/** WaDesk's timeouts: 20 s for the lookup and the revoke, 30 s for the attach. No retries: the operator presses the button again. */
const LOOKUP_TIMEOUT_MS = 20_000;
const REVOKE_TIMEOUT_MS = 20_000;
const ATTACH_TIMEOUT_MS = 30_000;
const ERROR_MAX = 300;

interface Transport {
  /** Replaces `https://graph.facebook.com` (tests point it at a local stub). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Replaces every timeout (tests). */
  timeoutMs?: number;
}

interface Reply {
  status: number;
  ok: boolean;
  json: Record<string, unknown> | undefined;
}

/** Meta's own wording when it gave one, else the status, so the operator sees what Meta said (WD-BSP-006 rule 6). */
function metaError(reply: Reply): string {
  const error = reply.json?.error as { message?: unknown } | undefined;
  return typeof error?.message === 'string' && error.message
    ? error.message
    : `HTTP ${reply.status}`;
}

/**
 * Path A of the reseller model: the platform is a Meta Solution Partner and shares its extended credit line onto the customer's
 * WABA, so Meta invoices the platform (WD-BSP-005, -006, -009). The calls are Meta's Graph API, bearer system-user token.
 *
 * Failures never throw: a timeout or a refusal comes back as `{ ok: false, error }` with text safe to show an operator (the token
 * is scrubbed from it), because "Meta said no" is an outcome the register records, not an exception.
 */
@Injectable()
export class MetaCreditSource implements CreditSourcePort {
  readonly name = 'meta' as const;
  private readonly logger = new Logger(MetaCreditSource.name);

  /** Overridden in tests; the defaults are the real thing. */
  transport: Transport = {};

  isConfigured(conn: Pick<CreditSourceConnection, 'businessId' | 'token'>): boolean {
    return conn.token.trim() !== '' && conn.businessId.trim() !== '';
  }

  private base(conn: CreditSourceConnection): string {
    return `${this.transport.baseUrl ?? 'https://graph.facebook.com'}/${conn.graphVersion}`;
  }

  private async call(
    conn: CreditSourceConnection,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    timeoutMs: number,
  ): Promise<Reply | { error: string }> {
    const fetchImpl = this.transport.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.transport.timeoutMs ?? timeoutMs),
      });
      const text = await res.text();
      let json: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = text ? JSON.parse(text) : undefined;
        json =
          parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
      } catch {
        json = undefined;
      }
      return { status: res.status, ok: res.ok, json };
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return { error: timedOut ? 'Meta did not answer in time.' : 'Could not reach Meta.' };
    }
  }

  private scrub(text: string, conn: CreditSourceConnection): string {
    const clean = conn.token.length >= 4 ? text.split(conn.token).join('***') : text;
    return clean.replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX);
  }

  async resolveCreditLine(conn: CreditSourceConnection): Promise<string | null> {
    if (conn.extendedCreditId.trim()) return conn.extendedCreditId.trim();
    const url = `${this.base(conn)}/${encodeURIComponent(conn.businessId)}/extendedcredits?fields=id,legal_entity_name`;
    const reply = await this.call(conn, 'GET', url, LOOKUP_TIMEOUT_MS);
    if ('error' in reply || !reply.ok) {
      this.logger.warn(
        { business: conn.businessId, status: 'error' in reply ? reply.error : reply.status },
        '[BSP-CREDIT] credit line lookup failed',
      );
      return null;
    }
    // Only the first credit line: WaDesk did the same, and a business with several picks one explicitly in the settings.
    const first = (reply.json?.data as Array<{ id?: unknown }> | undefined)?.[0]?.id;
    return typeof first === 'string' || typeof first === 'number' ? String(first) : null;
  }

  async attach(
    conn: CreditSourceConnection,
    creditLineId: string,
    wabaId: string,
    currency: string,
  ): Promise<CreditSourceResult<{ allocationConfigId: string }>> {
    // The WABA and its currency are query-string parameters, not a body (WD-BSP-006 rule 6).
    const url =
      `${this.base(conn)}/${encodeURIComponent(creditLineId)}/whatsapp_credit_sharing_and_attach` +
      `?waba_id=${encodeURIComponent(wabaId)}&waba_currency=${encodeURIComponent(currency)}`;
    const reply = await this.call(conn, 'POST', url, ATTACH_TIMEOUT_MS);
    if ('error' in reply) return { ok: false, error: reply.error };
    const id = reply.json?.allocation_config_id;
    const allocationConfigId = typeof id === 'string' || typeof id === 'number' ? String(id) : '';
    if (reply.ok && allocationConfigId) return { ok: true, allocationConfigId };
    const error = this.scrub(
      reply.ok ? 'Meta accepted the request but returned no allocation id.' : metaError(reply),
      conn,
    );
    this.logger.warn({ waba: wabaId, status: reply.status }, '[BSP-CREDIT] attach refused');
    return { ok: false, error };
  }

  async revoke(
    conn: CreditSourceConnection,
    allocationConfigId: string,
  ): Promise<CreditSourceResult<Record<never, never>>> {
    if (!allocationConfigId) return { ok: false, error: 'No allocation id to revoke.' };
    const url = `${this.base(conn)}/${encodeURIComponent(allocationConfigId)}`;
    const reply = await this.call(conn, 'DELETE', url, REVOKE_TIMEOUT_MS);
    if ('error' in reply) return { ok: false, error: reply.error };
    if (reply.ok) return { ok: true };
    this.logger.warn(
      { allocation: allocationConfigId, status: reply.status },
      '[BSP-CREDIT] revoke refused',
    );
    return { ok: false, error: this.scrub(metaError(reply), conn) };
  }
}
