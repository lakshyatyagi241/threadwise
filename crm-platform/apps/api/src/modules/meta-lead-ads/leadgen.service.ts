import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MetaLeadgenJob } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  META_LEAD_ADS_GRAPH,
  type GraphLead,
  type MetaLeadAdsGraph,
  type MetaLeadAdsPageApi,
} from '../../infra/providers/meta-lead-ads/meta-lead-ads.port';
import { FacebookPagesRepository, type FacebookPageRow } from '../channel-facebook';
import { LEAD_INGEST, type LeadIngestPort, type LeadIngestResult } from '../leads/lead-ingest.port';
import { MetaLeadAdsRepository, type FormRow, type PageStateRow } from './meta-lead-ads.repository';
import {
  SWEEP_MAX_LEADS,
  classifyGraphError,
  clipError,
  leadAccessOf,
  sweepSince,
  toNormalisedLead,
} from './meta-lead-rules';

export type LeadgenSkip = 'sync_off' | 'page_not_connected' | 'form_not_picked' | 'source_paused';

export type LeadgenOutcome =
  | { kind: 'delivered'; result: LeadIngestResult['status'] }
  | { kind: 'skipped'; reason: LeadgenSkip }
  | { kind: 'refused'; reason: 'token' | 'permission' | 'other' };

export interface SweepResult {
  forms: number;
  /** Leads read from Meta that the pipeline did not already hold. */
  delivered: number;
  /** Forms read to the end (their checkpoint moved). */
  complete: number;
  skipped: boolean;
}

interface PageContext {
  state: PageStateRow;
  fb: FacebookPageRow;
  forms: FormRow[];
}

/**
 * Receiving leads (spec L-06, BL-011): the webhook worker and the reconciliation sweep. Both end in the lead pipeline's ingest port, which
 * stores every delivery under (source, Meta's lead id) and answers `duplicate` for one it holds, so the webhook, Meta's redelivery and the
 * sweep can all bring the same lead in and it is still one contact and one notification.
 *
 * Runs in the worker with no user: tenant scope comes from the job's `orgId`. A Page's token is decrypted for the call at hand and never
 * logged. Meta slowing us down (or failing) throws, so the queue retries with backoff; Meta refusing the token or a permission does not
 * (a retry cannot fix it): it is written on the Page for the screen to show, and the sweep keeps trying until the admin reconnects.
 */
@Injectable()
export class LeadgenService {
  private readonly logger = new Logger(LeadgenService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MetaLeadAdsRepository,
    private readonly pages: FacebookPagesRepository,
    private readonly crypto: CryptoService,
    @Inject(META_LEAD_ADS_GRAPH) private readonly graph: MetaLeadAdsGraph,
    @Inject(LEAD_INGEST) private readonly ingest: LeadIngestPort,
  ) {}

  // --- the webhook ----------------------------------------------------------------------------------------------------------

  /** One `leadgen` event: fetch the lead by its id and hand it to the pipeline. */
  async handleWebhook(job: MetaLeadgenJob): Promise<LeadgenOutcome> {
    const { orgId } = job;
    const ctx = await this.load(orgId, job.pageId);
    if (!ctx?.state.enabled) return { kind: 'skipped', reason: 'sync_off' };
    if (ctx.fb.status !== 'connected') return { kind: 'skipped', reason: 'page_not_connected' };

    // An event that names a form that was never picked is dropped before any call to Meta.
    let form = job.formId ? ctx.forms.find((f) => f.formId === job.formId) : undefined;
    if (job.formId && !form) return { kind: 'skipped', reason: 'form_not_picked' };
    if (form && form.sourceStatus !== 'active') return { kind: 'skipped', reason: 'source_paused' };

    const read = await this.api(ctx.fb).getLead(job.leadgenId);
    if (!read.ok || !read.data) {
      const kind = classifyGraphError(read.code);
      if (kind === 'transient') {
        throw new Error(
          `Meta could not be reached for lead ${job.leadgenId}: ${read.error ?? 'no answer'}`,
        );
      }
      await this.recordRefusal(orgId, job.pageId, form, kind, read.error);
      return { kind: 'refused', reason: kind };
    }
    const lead = read.data;
    // The lead says which form it came from; trust it over the event (an event without a form id, or a stale one).
    form = ctx.forms.find((f) => f.formId === (lead.formId ?? job.formId));
    if (!form) return { kind: 'skipped', reason: 'form_not_picked' };
    if (form.sourceStatus !== 'active') return { kind: 'skipped', reason: 'source_paused' };

    const result = await this.deliver(orgId, form, lead);
    return { kind: 'delivered', result: result.status };
  }

  // --- the sweep ------------------------------------------------------------------------------------------------------------

  /**
   * Re-reads the recent leads of every picked, active form of one Page, so a webhook Meta never delivered (or one we failed to process
   * past its retries) does not lose a lead. A form is read from its checkpoint (minus an overlap) and the checkpoint only moves when the
   * read reached the end and every lead in it was delivered, so an interrupted run is simply run again. Leads the pipeline already
   * holds are filtered out first; the rest go through the same ingest as the webhook, idempotent on Meta's lead id.
   */
  async sweepPage(orgId: number, pageId: string): Promise<SweepResult> {
    const ctx = await this.load(orgId, pageId);
    const empty: SweepResult = { forms: 0, delivered: 0, complete: 0, skipped: true };
    if (!ctx?.state.enabled || ctx.fb.status !== 'connected') return empty;
    if (leadAccessOf(ctx.fb.scopes).access !== 'granted') return empty;
    const forms = ctx.forms.filter((f) => f.sourceStatus === 'active');
    if (forms.length === 0) return empty;

    const api = this.api(ctx.fb);
    const started = new Date();
    const out: SweepResult = { forms: forms.length, delivered: 0, complete: 0, skipped: false };
    for (const form of forms) {
      const read = await api.listFormLeads(
        form.formId,
        sweepSince(form.sweepCheckpointAt, started),
        SWEEP_MAX_LEADS,
      );
      if (!read.ok || !read.data) {
        const kind = classifyGraphError(read.code);
        this.logger.warn(
          { orgId, pageId, form: form.formId, code: read.code },
          'lead sweep read failed',
        );
        if (kind === 'transient') continue;
        await this.recordRefusal(orgId, pageId, form, kind, read.error);
        // A revoked token or a withheld permission is the Page's, not the form's: the other forms would be refused the same way.
        if (kind !== 'other') break;
        continue;
      }
      const { leads, capped } = read.data;
      const held = this.ingest.settled
        ? new Set(
            await this.ingest.settled(
              orgId,
              form.sourceId,
              leads.map((l) => l.id),
            ),
          )
        : new Set<string>();
      let clean = !capped;
      for (const lead of leads) {
        if (held.has(lead.id)) continue;
        try {
          const result = await this.deliver(orgId, form, lead);
          out.delivered += 1;
          if (result.status === 'failed') clean = false;
        } catch (err) {
          clean = false;
          this.logger.warn({ err, orgId, pageId, lead: lead.id }, 'lead sweep delivery failed');
        }
      }
      if (clean) {
        await this.db.txAs({ orgId }, (tx) =>
          this.repo.recordFormSweep(tx, orgId, form.id, started),
        );
        out.complete += 1;
      }
    }
    if (out.complete === forms.length) {
      await this.db.txAs({ orgId }, (tx) => this.repo.recordPageSweep(tx, orgId, pageId));
    }
    return out;
  }

  // --- shared ---------------------------------------------------------------------------------------------------------------

  private async deliver(orgId: number, form: FormRow, lead: GraphLead): Promise<LeadIngestResult> {
    const normalised = toNormalisedLead(lead, {
      formId: form.formId,
      name: form.name,
      pageId: form.pageId,
      checkboxes: form.checkboxes,
    });
    const result = await this.ingest.ingest(orgId, form.sourceId, normalised);
    const at = lead.createdTime ? new Date(lead.createdTime) : new Date();
    await this.db.txAs({ orgId }, async (tx) => {
      if (result.status === 'failed') {
        await this.repo.recordFormError(
          tx,
          orgId,
          form.id,
          clipError(
            `The lead pipeline could not store lead ${lead.id}: ${result.reason ?? 'unknown'}`,
          ) ?? '',
        );
        return;
      }
      await this.repo.recordPageLead(tx, orgId, form.pageId, at);
      await this.repo.recordFormLead(tx, orgId, form.id, at);
    });
    return result;
  }

  private async load(orgId: number, pageId: string): Promise<PageContext | undefined> {
    return this.db.txAs({ orgId }, async (tx) => {
      const state = await this.repo.findPage(tx, orgId, pageId);
      const fb = await this.pages.findByPageId(tx, orgId, pageId);
      if (!state || !fb) return undefined;
      return { state, fb, forms: await this.repo.listForms(tx, orgId, pageId) };
    });
  }

  private api(fb: FacebookPageRow): MetaLeadAdsPageApi {
    return this.graph.forPage(this.crypto.decrypt(fb.accessToken ?? ''), fb.pageId);
  }

  private async recordRefusal(
    orgId: number,
    pageId: string,
    form: FormRow | undefined,
    kind: 'token' | 'permission' | 'other',
    message: string | undefined,
  ): Promise<void> {
    const text = clipError(message) ?? 'Meta refused the request.';
    await this.db.txAs({ orgId }, async (tx) => {
      await this.repo.recordPageError(tx, orgId, pageId, kind, text);
      if (form) await this.repo.recordFormError(tx, orgId, form.id, text);
    });
  }
}
