import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, LEAD_HOOK_MAX_BODY_BYTES, LEAD_HOOK_SECRET_HEADER } from '@crm/contracts';
import type { Request } from 'express';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { LeadIngestService } from './lead-ingest.service';
import type { NormalisedLead } from './lead-ingest.port';
import { deriveExternalId, flattenPayload } from './lead-mapping';
import { LeadsPlan } from './lead-plan';
import { LeadSourcesRepository } from './lead-sources.repository';
import { LeadHookThrottle } from './lead-throttle';
import { hashLeadToken, looksLikeLeadToken, secretMatches } from './lead-token';

type Raw = Request & { rawBody?: Buffer };

/** Everything the door says about a lead, whatever became of it: nothing about the workspace, the contact or the outcome. */
export const HOOK_ACK = { ok: true, received: true } as const;

/** One answer for "no such hook": an unknown or malformed token, a paused source, a workspace whose plan has no lead sources. */
const unknownHook = (): AppError => AppError.notFound('Lead hook');

const isJson = (type: string | undefined): boolean =>
  /^application\/(.+\+)?json\b/i.test(type ?? '');
const isForm = (type: string | undefined): boolean =>
  /^application\/x-www-form-urlencoded\b/i.test(type ?? '');

/**
 * The generic webhook door (spec L-04): `POST /v2/public/lead-hooks/:token`. Reference's `/hooks/in/{token}` is the behavioural reference
 * (the random token IS the access control, JSON or form body, one 200 for the sender); what is different is on purpose:
 *
 *  - the token is looked up by its hash, through a SECURITY DEFINER function (no tenant exists yet on a public route);
 *  - per-IP and per-token rate limits, the IP one before any lookup;
 *  - an optional shared secret in `X-Webhook-Secret`, compared in constant time;
 *  - a body cap, and only JSON objects and form bodies are accepted;
 *  - one answer whatever happened to the lead: nothing says whether a contact existed, was created or was updated. A hook that is
 *    unknown, paused, malformed or switched off by the plan is the same 404;
 *  - the lead is stored before it is processed, idempotently, and a lead that cannot become a contact is kept (`needs_review`), so the
 *    sender never needs to retry for our sake: a 200 means "we have it".
 *
 * Auth is the token alone: no API key, no HMAC (a Zapier step cannot sign), by design.
 */
@Injectable()
export class LeadHooksService {
  private readonly logger = new Logger(LeadHooksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sources: LeadSourcesRepository,
    private readonly ingest: LeadIngestService,
    private readonly throttle: LeadHookThrottle,
    private readonly plan: LeadsPlan,
    private readonly crypto: CryptoService,
  ) {}

  async receive(token: string, req: Raw): Promise<typeof HOOK_ACK> {
    const ctx = RequestContextStore.require();
    await this.throttle.checkIp(ctx.ip);
    if (!looksLikeLeadToken(token)) throw unknownHook();

    const tokenHash = hashLeadToken(token);
    const hit = await this.lookup(tokenHash);
    if (!hit || hit.status !== 'active') throw unknownHook();
    await this.throttle.checkToken(tokenHash);
    // From here the request is that workspace's, like any other.
    ctx.orgId = hit.orgId;
    if (!(await this.plan.isEnabled(hit.orgId))) throw unknownHook();

    const source = await this.db.txAs({ orgId: hit.orgId, userId: null }, (tx) =>
      this.sources.findById(tx, hit.orgId, hit.sourceId),
    );
    if (!source || source.status !== 'active') throw unknownHook();

    if (source.secretEnc) {
      const presented = req.header(LEAD_HOOK_SECRET_HEADER) ?? undefined;
      if (!secretMatches(presented, this.crypto.decrypt(source.secretEnc))) {
        this.logger.warn(
          { orgId: hit.orgId, source: source.uuid },
          'lead hook refused: bad shared secret',
        );
        throw AppError.unauthenticated('The shared secret is missing or wrong.');
      }
    }

    const body = this.bodyOf(req);
    const fields = flattenPayload(body);
    const { externalId } = deriveExternalId({ fields, raw: body }, body, source.externalIdPath);
    const lead: NormalisedLead = {
      externalId,
      receivedAt: new Date().toISOString(),
      fields,
      raw: body,
    };
    await this.ingest.process(hit.orgId, source.id, lead, {});
    return HOOK_ACK;
  }

  /** The tenant a token belongs to: one SECURITY DEFINER lookup returning ids and a status, nothing else. */
  private async lookup(
    tokenHash: string,
  ): Promise<{ orgId: number; sourceId: number; status: string } | null> {
    const res = await this.db.primary.execute(sql`SELECT * FROM lead_source_lookup(${tokenHash})`);
    const r = res.rows[0] as
      | { route_org_id: number | string; route_source_id: number | string; route_status: string }
      | undefined;
    return r
      ? {
          orgId: Number(r.route_org_id),
          sourceId: Number(r.route_source_id),
          status: r.route_status,
        }
      : null;
  }

  /** The parsed body of a JSON or form request: a non-empty object, within the cap. */
  private bodyOf(req: Raw): Record<string, unknown> {
    const type = req.header('content-type');
    const declared = Number(req.header('content-length') ?? 0);
    if (
      declared > LEAD_HOOK_MAX_BODY_BYTES ||
      (req.rawBody?.length ?? 0) > LEAD_HOOK_MAX_BODY_BYTES
    ) {
      throw new AppError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        'The request body is too large.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (!isJson(type) && !isForm(type)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Send the lead as application/json or application/x-www-form-urlencoded.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const body: unknown = req.body;
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length === 0
    ) {
      throw AppError.validation(
        'The body must be a JSON object (or a form) with at least one field.',
        [{ path: 'body', message: 'object_required' }],
      );
    }
    return body as Record<string, unknown>;
  }
}
