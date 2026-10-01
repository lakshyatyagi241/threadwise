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

  /** `POST {graph}/{wabaId}/message_templates`. An empty id back is an error, as it is in WaDesk. */
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
}
