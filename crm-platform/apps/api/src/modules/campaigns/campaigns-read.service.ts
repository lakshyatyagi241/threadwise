import { Inject, Injectable } from '@nestjs/common';
import {
  CAMPAIGN_PAGE_SIZE,
  RECIPIENT_PAGE_SIZE,
  TEXT_FILTER_TYPES,
  type CampaignBuilder,
  type CampaignConfig,
  type CampaignDetail,
  type CampaignListResponse,
  type CampaignLive,
  type CampaignRecipientsResponse,
  type CampaignStatus,
  type ListCampaignsQuery,
  type ListRecipientsQuery,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  BroadcastsComposeService,
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  type SenderDirectory,
  type TemplateDirectory,
} from '../broadcasts';
import { pct, reconciledStatus, utcToLocalDateTime } from './campaign-rules';
import { toCampaign, toConfig } from './campaigns.mapper';
import { CampaignsRepository, type CampaignRow } from './campaigns.repository';

const DAY = 86_400_000;
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

/** A column that holds encrypted text, read back as plain text (null stays null; unreadable text is shown as empty). */
function open(crypto: CryptoService, v: string | null): string | null {
  if (v === null || v === '') return v;
  try {
    return crypto.decrypt(v);
  } catch {
    return '';
  }
}

/**
 * What the campaign screens read: the list with its tiles and health cards, the builder's pickers, the edit form, the detail page
 * with its funnel and tabs, and the live numbers it repaints. Every count comes from the recipient rows, not from the
 * columns the campaign keeps (Reference found those lag the delivery webhooks), and a campaign whose recipients are all resolved is
 * finished here even when the sender never got to say so.
 */
@Injectable()
export class CampaignsReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CampaignsRepository,
    private readonly crypto: CryptoService,
    private readonly compose: BroadcastsComposeService,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  async list(q: ListCampaignsQuery): Promise<CampaignListResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const all = await this.repo.listAll(tx, orgId);
      for (const c of all) await this.reconcile(tx, orgId, c);

      const now = Date.now();
      const sevenDays = now - 7 * DAY;
      let rows = all;
      if (q.status === 'recently_created')
        rows = rows.filter((c) => c.createdAt.getTime() >= sevenDays);
      else if (q.status === 'recently_updated')
        rows = rows.filter((c) => c.updatedAt.getTime() >= sevenDays);
      else if (q.status !== 'all') rows = rows.filter((c) => c.status === q.status);
      if (q.type === 'text')
        rows = rows.filter((c) => (TEXT_FILTER_TYPES as readonly string[]).includes(c.type));
      else if (q.type !== 'all') rows = rows.filter((c) => c.type === q.type);
      if (q.range !== 'all') {
        const cutoff = now - RANGE_DAYS[q.range] * DAY;
        rows = rows.filter((c) => c.createdAt.getTime() >= cutoff);
      }
      if (q.q !== '') {
        const needle = q.q.toLowerCase();
        rows = rows.filter((c) => c.name.toLowerCase().includes(needle));
      }

      const start = (q.page - 1) * CAMPAIGN_PAGE_SIZE;
      const count = (status: string) => all.filter((c) => c.status === status).length;
      const sentTotal = all.reduce((n, c) => n + c.counts.sent, 0);
      const deliveredTotal = all.reduce((n, c) => n + c.counts.delivered, 0);
      const failingCampaigns = all.filter((c) => c.counts.failed > 5).length;
      const tpl = await this.repo.templateHealth(tx, orgId);
      const dev = await this.repo.deviceHealth(tx, orgId);

      return {
        data: rows.slice(start, start + CAMPAIGN_PAGE_SIZE).map(toCampaign),
        page: { page: q.page, perPage: CAMPAIGN_PAGE_SIZE, total: rows.length },
        stats: {
          total: all.length,
          queued: count('scheduled'),
          running: count('running'),
          completed: count('completed'),
          failed: count('failed'),
          sentTotal,
          deliveredTotal,
          readTotal: all.reduce((n, c) => n + c.counts.read, 0),
          failedTotal: all.reduce((n, c) => n + c.counts.failed, 0),
          processing: count('running'),
        },
        statusCounts: {
          all: all.length,
          recentlyCreated: all.filter((c) => c.createdAt.getTime() >= sevenDays).length,
          recentlyUpdated: all.filter((c) => c.updatedAt.getTime() >= sevenDays).length,
          scheduled: count('scheduled'),
          running: count('running'),
          completed: count('completed'),
          failed: count('failed'),
        },
        messageTypes: {
          text: all.filter((c) => (TEXT_FILTER_TYPES as readonly string[]).includes(c.type)).length,
          template: all.filter((c) => c.type === 'template').length,
          flow: all.filter((c) => c.type === 'flow').length,
        },
        deliveryHealth: {
          avgDeliveryRate: pct(deliveredTotal, sentTotal),
          failingCampaigns,
          status: failingCampaigns > 0 ? 'warning' : 'healthy',
        },
        queueHealth: {
          templateApprovalRate: tpl.total > 0 ? Math.round((tpl.approved / tpl.total) * 100) : null,
          templateApproved: tpl.approved,
          templateTotal: tpl.total,
          devicesReady: dev.total > 0 ? `${dev.connected}/${dev.total}` : 'N/A',
          retryBacklog: all.reduce((n, c) => n + c.counts.failed, 0),
        },
      };
    });
  }

  /** A campaign whose recipients are all resolved is finished; the status is saved so the list and the detail agree. */
  private async reconcile(
    tx: Parameters<CampaignsRepository['count']>[0],
    orgId: number,
    c: CampaignRow,
  ): Promise<void> {
    const next = reconciledStatus(c.status, c.counts);
    if (!next) return;
    await this.repo.setStatus(tx, orgId, c.id, next, { completed: true });
    c.status = next;
    c.completedAt = c.completedAt ?? new Date();
  }

  async builder(): Promise<CampaignBuilder> {
    const { orgId } = RequestContextStore.require();
    const base = await this.compose.compose();
    return this.db.tx(async (tx) => ({
      senders: base.senders,
      templates: base.templates,
      groups: await this.repo.groupsWithCounts(tx, orgId),
      tags: await this.repo.tagsWithCounts(tx, orgId),
      flows: await this.repo.flowsForOrg(tx, orgId),
      requiresApprovedTemplates: (await this.senders.defaultEngine(tx, orgId)) === 'waba',
    }));
  }

  /** The whole campaign for the edit form. Only an editable campaign can be edited, but any can be read. */
  async config(uuid: string): Promise<CampaignConfig> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const c = await this.repo.findByUuid(tx, orgId, uuid);
      if (!c) throw AppError.notFound('Campaign', uuid);
      const sender = await this.repo.senderLabel(tx, orgId, c.provider, c.deviceId);
      return toConfig(c, {
        senderKey: sender.key,
        customMessage: open(this.crypto, c.customMessage),
        customMessageB: open(this.crypto, c.customMessageB),
        customHeader: open(this.crypto, c.customHeader),
        customFooter: open(this.crypto, c.customFooter),
        mediaUrl: c.customImage ?? c.customVideo ?? c.customDocument,
        expiresAtLocal: utcToLocalDateTime(c.expiresAt, c.timezone ?? 'UTC'),
        recipientContactIds: await this.repo.recipientContactIds(tx, orgId, c.id),
      });
    });
  }

  async detail(uuid: string): Promise<CampaignDetail> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, orgId, uuid);
      if (!found) throw AppError.notFound('Campaign', uuid);
      // The stored counters are brought in line with the rows on every open (the KPI cards read them elsewhere).
      await this.repo.recount(tx, orgId, found.id);
      await this.reconcile(tx, orgId, found);
      const c = (await this.repo.findById(tx, orgId, found.id)) ?? found;
      const campaign = toCampaign(c);
      const n = campaign.counts;
      const zone = c.timezone ?? 'UTC';

      const sender = await this.repo.senderLabel(tx, orgId, c.provider, c.deviceId);
      const tplId = c.templateId;
      const tpl = tplId === null ? undefined : await this.templates.findById(tx, orgId, tplId);
      const makeup = await this.repo.audienceMakeup(tx, orgId, c.id);
      const failures = await this.repo.failures(tx, orgId, c.id, 50);

      const manual = Math.max(0, makeup.total - makeup.withContact);
      const parts: string[] = [];
      if (makeup.groups.length > 0) parts.push(makeup.groups.slice(0, 2).join(', '));
      else if (makeup.withContact > 0) parts.push('Ungrouped');
      if (manual > 0) parts.push(`${manual.toLocaleString('en-US')} manual`);

      const buttons = (
        tpl && Array.isArray(tpl.buttons) ? tpl.buttons : (c.customButtons ?? [])
      ) as Array<Record<string, unknown>>;
      return {
        campaign,
        rates: {
          delivered: pct(n.delivered, n.recipients),
          read: pct(n.read, n.delivered),
          replies: pct(n.replies, n.recipients),
          clicks: pct(n.clicks, n.recipients),
          failed: pct(n.failed, n.recipients),
        },
        funnel: [
          { key: 'recipients', count: n.recipients },
          { key: 'sent', count: n.sent },
          { key: 'delivered', count: n.delivered },
          { key: 'read', count: n.read },
          { key: 'replies', count: n.replies },
        ],
        hourly: await this.repo.hourly(tx, orgId, c.id, zone),
        daily: await this.repo.daily(tx, orgId, c.id, zone),
        outcomes: (await this.repo.statusBreakdown(tx, orgId, c.id)) as CampaignDetail['outcomes'],
        variants: c.abTesting ? await this.repo.variantBreakdown(tx, orgId, c.id) : [],
        preview: {
          body: tpl ? tpl.templateBody : (open(this.crypto, c.customMessage) ?? ''),
          header: tpl ? tpl.header : open(this.crypto, c.customHeader),
          footer: tpl ? tpl.footer : open(this.crypto, c.customFooter),
          buttons,
          templateName: tpl?.templateName ?? null,
          category: null,
          mediaUrl: c.customImage ?? c.customVideo ?? c.customDocument,
        },
        audience: {
          uploaded: c.totalRecipients,
          manual,
          invalid: makeup.invalid,
          optOutSkipped: makeup.optedOut,
          finalList: Math.max(0, c.totalRecipients - makeup.optedOut),
          label: parts.length > 0 ? parts.join(' · ') : 'All contacts',
        },
        senderLabel: sender.label || '—',
        failedCount: n.failed,
        deliveryIssueReason: failures[0]?.error.trim() || null,
        optOutCount: makeup.optedOut,
        optInCount: await this.repo.optInCount(tx, orgId, c.id),
        failures: failures.map((f) => ({ ...f, at: f.at.toISOString() })),
        failureSummary: await this.repo.failureSummary(tx, orgId, c.id, 5),
        replies: (await this.repo.replies(tx, orgId, c.id, 10)).map((r) => ({
          ...r,
          at: r.at.toISOString(),
        })),
      };
    });
  }

  /** The 15-second refresh of the detail page. */
  async live(uuid: string): Promise<CampaignLive> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, orgId, uuid);
      if (!found) throw AppError.notFound('Campaign', uuid);
      await this.repo.recount(tx, orgId, found.id);
      await this.reconcile(tx, orgId, found);
      const c = (await this.repo.findById(tx, orgId, found.id)) ?? found;
      const n = toCampaign(c).counts;
      const failures = await this.repo.failures(tx, orgId, c.id, 10);
      return {
        status: c.status as CampaignStatus,
        counts: n,
        rates: {
          delivered: pct(n.delivered, n.recipients),
          read: pct(n.read, n.delivered),
          replies: pct(n.replies, n.recipients),
          clicks: pct(n.clicks, n.recipients),
          failed: pct(n.failed, n.recipients),
        },
        failures: failures.map((f) => ({ ...f, at: f.at.toISOString() })),
        failureSummary: await this.repo.failureSummary(tx, orgId, c.id, 5),
      };
    });
  }

  async recipients(uuid: string, q: ListRecipientsQuery): Promise<CampaignRecipientsResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const c = await this.repo.findByUuid(tx, orgId, uuid);
      if (!c) throw AppError.notFound('Campaign', uuid);
      const page = await this.repo.recipientsPage(tx, orgId, c.id, {
        status: q.status,
        q: q.q,
        limit: RECIPIENT_PAGE_SIZE,
        offset: (q.page - 1) * RECIPIENT_PAGE_SIZE,
      });
      return {
        data: page.rows.map((r) => ({
          id: r.uuid,
          contactId: r.contactUuid,
          name: r.name ?? '',
          phone: r.phone ?? '',
          variant: r.variant,
          status: r.status as CampaignRecipientsResponse['data'][number]['status'],
          clicked: r.clicked,
          clickCount: r.clickCount,
          sentAt: r.sentAt?.toISOString() ?? null,
          deliveredAt: r.deliveredAt?.toISOString() ?? null,
          readAt: r.readAt?.toISOString() ?? null,
          respondedAt: r.respondedAt?.toISOString() ?? null,
          error: r.error,
        })),
        page: { page: q.page, perPage: RECIPIENT_PAGE_SIZE, total: page.total },
      };
    });
  }
}
