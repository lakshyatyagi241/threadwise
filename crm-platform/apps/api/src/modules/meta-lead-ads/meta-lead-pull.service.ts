import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  META_LEAD_ADS_GRAPH,
  type FormLeadsPage,
  type GraphLead,
  type MetaLeadAdsGraph,
  type MetaLeadAdsPageApi,
} from '../../infra/providers/meta-lead-ads/meta-lead-ads.port';
import { FacebookPagesRepository, type FacebookPageRow } from '../channel-facebook';
import { LEAD_INGEST, type LeadIngestPort } from '../leads/lead-ingest.port';
// Only the leaf port of the lead pipeline's pulls: this module never imports the leads module's classes.
import type { LeadPullProgress, LeadPullRequest, LeadPullResult } from '../leads/lead-pull.port';
import { LeadgenService } from './leadgen.service';
import { MetaLeadAdsRepository, type FormRow, type PageStateRow } from './meta-lead-ads.repository';
import { classifyGraphError, leadAccessOf, sweepSince } from './meta-lead-rules';
import {
  PULL_HARD_CAP,
  PULL_MAX_PAGES,
  PULL_MAX_RETRIES,
  PULL_PACE_MS,
  PULL_PAGE_SIZE,
  PULL_REST_PIECE_MS,
  PULL_SPLIT_ABOVE,
  backoffMs,
  canSplit,
  clampRange,
  halves,
  inWindow,
  isRateLimited,
  sinceOf,
  untilOf,
  windowsOf,
  type PullWindow,
} from './meta-lead-pull.rules';

const SETTLED_CHUNK = 500;

type Stop =
  | { kind: 'stop'; reason: 'token' | 'permission' | 'other'; message: string | undefined }
  | { kind: 'stop'; reason: 'exhausted'; rateLimited: boolean; message: string | undefined };

type WindowRead = { kind: 'ok'; leads: GraphLead[]; truncated: boolean } | { kind: 'split' } | Stop;

interface RunState {
  counts: LeadPullProgress;
  progress: LeadPullRequest['progress'];
  lastCallAt: number;
}

interface FormContext {
  form: FormRow;
  state: PageStateRow | undefined;
  fb: FacebookPageRow | undefined;
}

/**
 * "Sync now" and backfill for one Meta lead form (BL-204, BL-210): the form's leads in a time range, read from Graph a page at a time,
 * oldest window first, and handed to the lead pipeline exactly as the webhook and the sweep hand them (`LeadgenService.deliver`, which
 * stores every lead under Meta's lead id, so a lead fetched twice is one contact and one notification). Nothing about consent changes:
 * the consent proof is read from the form's own disclaimer checkbox by the same function, never from the fact that it is a backfill.
 *
 * Meta's limits are kept the way the marketplace keeps a portal's: one request a second at most; a request Meta slowed down or failed is
 * waited out with a growing pause (30, 60, 120, 240 seconds when it said "slow down") and tried again, then the run stops as
 * `throttled` or `partial`, never as an error the person has to read. A token Meta revoked or a permission it withheld stops the run at
 * once, and is written on the Page for the Meta screen to show. A window that holds too many leads is read again as two halves.
 *
 * "Sync now" reads from the form's sweep checkpoint (less the sweep's overlap) and, when every lead of the window was handed over,
 * moves that checkpoint like a sweep. A backfill never touches it.
 */
@Injectable()
export class MetaLeadPullService {
  private readonly logger = new Logger(MetaLeadPullService.name);

  /** A method, not a field, so a test replaces it on the prototype and no real second is ever waited. */
  sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MetaLeadAdsRepository,
    private readonly pages: FacebookPagesRepository,
    private readonly crypto: CryptoService,
    private readonly leadgen: LeadgenService,
    @Inject(META_LEAD_ADS_GRAPH) private readonly graph: MetaLeadAdsGraph,
    @Inject(LEAD_INGEST) private readonly ingest: LeadIngestPort,
  ) {}

  /** Whether a lead source is a picked Meta form of this workspace (the provider's answer to "can you pull this?"). */
  async hasForm(orgId: number, sourceUuid: string): Promise<boolean> {
    const form = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.findFormBySourceUuid(tx, orgId, sourceUuid),
    );
    return form !== undefined;
  }

  async run(req: LeadPullRequest): Promise<LeadPullResult> {
    const counts: LeadPullProgress = {
      fetched: 0,
      accepted: 0,
      duplicates: 0,
      failed: 0,
      windowsDone: 0,
      windowsTotal: 0,
    };
    const end = (status: LeadPullResult['status'], error?: string): LeadPullResult => ({
      status,
      ...(error ? { error } : {}),
      progress: counts,
    });
    const orgId = req.orgId;

    const ctx = await this.load(orgId, req.source.uuid);
    if (!ctx) return end('failed', 'not_supported');
    const { form, state, fb } = ctx;
    if (!state?.enabled || !fb || fb.status !== 'connected' || form.sourceStatus !== 'active') {
      return end('failed', 'not_active');
    }
    if (leadAccessOf(fb.scopes).access !== 'granted') return end('failed', 'permission_missing');

    const started = new Date();
    let range: { from: number; to: number } | null;
    if (req.mode === 'backfill') {
      if (!req.from || !req.to) return end('failed', 'range_invalid');
      range = clampRange(req.from, req.to, started);
      if (!range) return end('failed', 'range_too_old');
    } else {
      range = {
        from: sweepSince(form.sweepCheckpointAt, started) * 1000,
        to: started.getTime(),
      };
    }

    let api: MetaLeadAdsPageApi;
    try {
      api = this.graph.forPage(this.crypto.decrypt(fb.accessToken ?? ''), fb.pageId);
    } catch (err) {
      this.logger.warn({ err, orgId, page: fb.pageId }, 'meta page token could not be read');
      return end('failed', 'credentials_refused');
    }

    const todo = windowsOf(range.from, range.to);
    counts.windowsTotal = todo.length;
    const run: RunState = { counts, progress: req.progress, lastCallAt: 0 };
    let incomplete = false;

    while (todo.length > 0) {
      const window = todo[0]!;
      const read = await this.readWindow(api, form, window, run);
      if (read.kind === 'stop') return this.stopped(orgId, form, read, counts);
      if (read.kind === 'split') {
        todo.splice(0, 1, ...halves(window));
        counts.windowsTotal += 1;
        continue;
      }
      todo.shift();
      if (read.truncated) incomplete = true;
      counts.fetched += read.leads.length;
      if (!(await this.handOver(orgId, form, read.leads, run))) incomplete = true;
      counts.windowsDone += 1;
      await req.progress(counts);
    }

    // "Sync now" has read the form to the end: the sweep need not read that window again.
    if (req.mode === 'sync' && !incomplete) {
      await this.db.txAs({ orgId }, (tx) => this.repo.recordFormSweep(tx, orgId, form.id, started));
    }
    return incomplete ? end('partial', 'incomplete') : end('ok');
  }

  // --- reading ---------------------------------------------------------------------------------------------------------------

  private async load(orgId: number, sourceUuid: string): Promise<FormContext | undefined> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const form = await this.repo.findFormBySourceUuid(tx, orgId, sourceUuid);
      if (!form) return undefined;
      return {
        form,
        state: await this.repo.findPage(tx, orgId, form.pageId),
        fb: await this.pages.findByPageId(tx, orgId, form.pageId),
      };
    });
  }

  /** Every lead of the window, oldest first, or the reason to stop, or the order to read it again as two halves. */
  private async readWindow(
    api: MetaLeadAdsPageApi,
    form: FormRow,
    window: PullWindow,
    run: RunState,
  ): Promise<WindowRead> {
    const splittable = canSplit(window);
    const cap = splittable ? PULL_SPLIT_ABOVE : PULL_HARD_CAP;
    const rows: GraphLead[] = [];
    let after: string | null = null;
    let truncated = false;
    for (let page = 0; page < PULL_MAX_PAGES; page++) {
      const cursor: string | null = after;
      const r: { kind: 'ok'; data: FormLeadsPage } | Stop = await this.ask<FormLeadsPage>(
        () =>
          api.pageFormLeads(form.formId, {
            sinceEpochSeconds: sinceOf(window),
            untilEpochSeconds: untilOf(window),
            after: cursor,
            limit: PULL_PAGE_SIZE,
          }),
        run,
      );
      if (r.kind === 'stop') return r;
      rows.push(...r.data.leads.filter((l) => inWindow(l.createdTime, window)));
      after = r.data.next;
      if (rows.length > cap) {
        if (splittable) return { kind: 'split' };
        truncated = true;
        break;
      }
      if (after === null) break;
      if (page === PULL_MAX_PAGES - 1) truncated = true;
      await run.progress(run.counts);
    }
    const kept = rows.slice(0, cap);
    // Meta lists newest first; contacts are created in the order the people applied.
    kept.sort((a, b) => Date.parse(a.createdTime ?? '') - Date.parse(b.createdTime ?? ''));
    return { kind: 'ok', leads: kept, truncated };
  }

  /** One Graph request at the pace of the run, waited out and tried again when Meta slowed down or failed. */
  private async ask<T>(
    call: () => Promise<{ ok: boolean; data?: T; error?: string; code?: number }>,
    run: RunState,
  ): Promise<{ kind: 'ok'; data: T } | Stop> {
    for (let attempt = 0; ; attempt++) {
      const wait = run.lastCallAt + PULL_PACE_MS - Date.now();
      if (wait > 0) await this.sleep(wait);
      const r = await call();
      run.lastCallAt = Date.now();
      if (r.ok && r.data !== undefined) return { kind: 'ok', data: r.data };
      const kind = classifyGraphError(r.code);
      if (kind !== 'transient') return { kind: 'stop', reason: kind, message: r.error };
      if (attempt >= PULL_MAX_RETRIES) {
        return {
          kind: 'stop',
          reason: 'exhausted',
          rateLimited: isRateLimited(r.code),
          message: r.error,
        };
      }
      await this.rest(backoffMs(r.code, attempt), run);
    }
  }

  /** Waits in pieces, saying after each that the run is alive. */
  private async rest(ms: number, run: RunState): Promise<void> {
    let left = ms;
    while (left > 0) {
      const piece = Math.min(left, PULL_REST_PIECE_MS);
      await this.sleep(piece);
      left -= piece;
      await run.progress(run.counts);
    }
  }

  // --- handing over ----------------------------------------------------------------------------------------------------------

  /** The leads of one window, oldest first, through the pipeline. False when any lead was not handed over. */
  private async handOver(
    orgId: number,
    form: FormRow,
    leads: GraphLead[],
    run: RunState,
  ): Promise<boolean> {
    const held = new Set<string>();
    if (this.ingest.settled) {
      for (let i = 0; i < leads.length; i += SETTLED_CHUNK) {
        const ids = leads.slice(i, i + SETTLED_CHUNK).map((l) => l.id);
        for (const id of await this.ingest.settled(orgId, form.sourceId, ids)) held.add(id);
      }
    }
    let clean = true;
    for (const lead of leads) {
      if (held.has(lead.id)) {
        run.counts.duplicates += 1;
        continue;
      }
      try {
        const result = await this.leadgen.deliver(orgId, form, lead);
        if (result.status === 'duplicate') run.counts.duplicates += 1;
        else if (result.status === 'failed') {
          run.counts.failed += 1;
          clean = false;
        } else run.counts.accepted += 1;
      } catch (err) {
        this.logger.warn({ err, orgId, lead: lead.id }, 'lead pull delivery failed');
        run.counts.failed += 1;
        clean = false;
      }
      await run.progress(run.counts);
    }
    return clean;
  }

  // --- stopping --------------------------------------------------------------------------------------------------------------

  private async stopped(
    orgId: number,
    form: FormRow,
    stop: Stop,
    counts: LeadPullProgress,
  ): Promise<LeadPullResult> {
    if (stop.reason === 'exhausted') {
      // Meta kept slowing us down, or could not be reached: what was read is in, the rest is for another run.
      if (stop.rateLimited) return { status: 'throttled', error: 'too_soon', progress: counts };
      return this.partialOrFailed('provider_error', counts);
    }
    // A revoked token or a withheld permission is the Page's problem: write it where the Meta screen shows it.
    await this.leadgen.recordRefusal(orgId, form.pageId, form, stop.reason, stop.message);
    const error =
      stop.reason === 'token'
        ? 'credentials_refused'
        : stop.reason === 'permission'
          ? 'permission_missing'
          : 'provider_error';
    return this.partialOrFailed(error, counts);
  }

  private partialOrFailed(error: string, counts: LeadPullProgress): LeadPullResult {
    const handed = counts.accepted + counts.duplicates;
    return { status: handed > 0 ? 'partial' : 'failed', error, progress: counts };
  }
}
