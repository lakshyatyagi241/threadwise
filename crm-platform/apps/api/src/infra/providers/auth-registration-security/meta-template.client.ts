import { Injectable } from '@nestjs/common';
import { OtpSendError, type WabaOtpConfig } from './otp-sender.port';
import {
  buildMetaTemplateCreateBody,
  buildMetaTemplateUpdateBody,
  mapMetaTemplateStatus,
  type MetaTemplateStatus,
} from './otp-payloads';
import { callProvider, httpFailure, joinUrl, metaErrorText, type CallOptions } from './otp-http';

type Transport = Pick<CallOptions, 'timeoutMs' | 'fetchImpl'>;
type WabaAccess = Pick<WabaOtpConfig, 'wabaId' | 'graphBaseUrl' | 'accessToken'>;

/** How many approved authentication templates the picker lists at most (Reference lists up to 300). */
export const META_TEMPLATE_LIST_LIMIT = 300;

export interface MetaApprovedTemplate {
  id: string;
  name: string;
  language: string;
  /** The copy-code button text, when the template has one. */
  buttonLabel: string | null;
}

export interface MetaTemplateSubmission {
  /** Meta's id for the template. */
  id: string;
  status: MetaTemplateStatus['status'];
  rejectedReason: string | null;
}

/**
 * The slice of Meta's message-template API the OTP template needs: submit an
 * authentication template, edit it, and read its review status back. The WABA
 * template domain replaces this when it lands; the shapes are Meta's.
 *
 * Failures are typed OtpSendError with a safe, readable message: the access
 * token never appears in it.
 */
@Injectable()
export class MetaTemplateClient {
  /** Overridden in tests (short timeout, stubbed fetch); the defaults are the real thing. */
  transport: Transport = {};

  private auth(access: WabaAccess) {
    return {
      opts: { provider: 'Meta', secrets: [access.accessToken], ...this.transport },
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        'Content-Type': 'application/json',
      },
    };
  }

  /** `POST {graph}/{wabaId}/message_templates`. An empty id back is an error, as it is in Reference. */
  async create(
    access: WabaAccess,
    input: { name: string; language: string; ttlMinutes: number },
  ): Promise<MetaTemplateSubmission> {
    const { opts, headers } = this.auth(access);
    const res = await callProvider(
      joinUrl(access.graphBaseUrl, access.wabaId, 'message_templates'),
      { method: 'POST', headers, body: JSON.stringify(buildMetaTemplateCreateBody(input)) },
      opts,
    );
    if (!res.ok) throw httpFailure(res, metaErrorText(res.json), opts);
    const body = (res.json ?? {}) as { id?: unknown; status?: unknown };
    const id = typeof body.id === 'string' || typeof body.id === 'number' ? String(body.id) : '';
    if (!id)
      throw new OtpSendError('rejected', 'Meta accepted the request but returned no template id.');
    // Meta answers a fresh submission with PENDING; default to it when the field is absent.
    const mapped = mapMetaTemplateStatus(typeof body.status === 'string' ? body.status : 'PENDING');
    return { id, status: mapped.status, rejectedReason: mapped.rejectedReason };
  }

  /** `POST {graph}/{templateId}`: sends the changed components back for review. */
  async update(
    access: WabaAccess,
    templateId: string,
    input: { ttlMinutes: number },
  ): Promise<void> {
    const { opts, headers } = this.auth(access);
    const res = await callProvider(
      joinUrl(access.graphBaseUrl, templateId),
      { method: 'POST', headers, body: JSON.stringify(buildMetaTemplateUpdateBody(input)) },
      opts,
    );
    if (!res.ok) throw httpFailure(res, metaErrorText(res.json), opts);
    if ((res.json as { success?: unknown } | undefined)?.success === false) {
      throw new OtpSendError('rejected', 'Meta did not accept the template change.');
    }
  }

  /** `GET {graph}/{templateId}?fields=id,name,status,rejected_reason`. */
  async status(access: WabaAccess, templateId: string): Promise<MetaTemplateStatus> {
    const { opts, headers } = this.auth(access);
    const url = `${joinUrl(access.graphBaseUrl, templateId)}?fields=id,name,status,rejected_reason`;
    const res = await callProvider(url, { method: 'GET', headers }, opts);
    if (!res.ok) throw httpFailure(res, metaErrorText(res.json), opts);
    const body = (res.json ?? {}) as { status?: unknown; rejected_reason?: unknown };
    return mapMetaTemplateStatus(
      typeof body.status === 'string' ? body.status : null,
      typeof body.rejected_reason === 'string' ? body.rejected_reason : null,
    );
  }

  /**
   * `GET {graph}/{wabaId}/message_templates?category=AUTHENTICATION&status=APPROVED&limit=300`:
   * the approved authentication templates of the account, newest first as Meta returns them. Rows
   * without an id or a name are dropped; the filter is repeated locally because a stub or an older
   * Graph version may ignore the query filters.
   */
  async listApprovedAuthentication(access: WabaAccess): Promise<MetaApprovedTemplate[]> {
    const { opts, headers } = this.auth(access);
    const query = new URLSearchParams({
      fields: 'id,name,status,language,category,components',
      category: 'AUTHENTICATION',
      status: 'APPROVED',
      limit: String(META_TEMPLATE_LIST_LIMIT),
    });
    const url = `${joinUrl(access.graphBaseUrl, access.wabaId, 'message_templates')}?${query}`;
    const res = await callProvider(url, { method: 'GET', headers }, opts);
    if (!res.ok) throw httpFailure(res, metaErrorText(res.json), opts);
    const rows = (res.json as { data?: unknown } | undefined)?.data;
    if (!Array.isArray(rows)) return [];
    const out: MetaApprovedTemplate[] = [];
    for (const raw of rows as Array<Record<string, unknown>>) {
      if (out.length >= META_TEMPLATE_LIST_LIMIT) break;
      const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '';
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (!id || !name) continue;
      if (typeof raw.status === 'string' && raw.status.toUpperCase() !== 'APPROVED') continue;
      if (typeof raw.category === 'string' && raw.category.toUpperCase() !== 'AUTHENTICATION') {
        continue;
      }
      out.push({
        id,
        name,
        language: typeof raw.language === 'string' ? raw.language : '',
        buttonLabel: otpButtonLabel(raw.components),
      });
    }
    return out;
  }
}

/** The text of the first OTP (copy-code / one-tap) button among a template's components. */
function otpButtonLabel(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  for (const c of components as Array<{ type?: unknown; buttons?: unknown }>) {
    if (typeof c?.type !== 'string' || c.type.toUpperCase() !== 'BUTTONS') continue;
    if (!Array.isArray(c.buttons)) continue;
    for (const b of c.buttons as Array<{ type?: unknown; text?: unknown }>) {
      if (
        typeof b?.type === 'string' &&
        b.type.toUpperCase() === 'OTP' &&
        typeof b.text === 'string'
      ) {
        return b.text.slice(0, 40);
      }
    }
  }
  return null;
}
