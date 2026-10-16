import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  META_LEAD_REQUIRED_SCOPES,
  type MetaLeadAdsOverview,
  type MetaLeadConnectStart,
  type MetaLeadForm,
  type MetaLeadFormList,
  type MetaLeadPage,
  type MetaLeadSourceHealth,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
} from '../../infra/providers/channel-facebook/facebook.port';
import {
  META_LEAD_ADS_GRAPH,
  type LeadForm,
  type MetaLeadAdsGraph,
  type MetaLeadAdsPageApi,
} from '../../infra/providers/meta-lead-ads/meta-lead-ads.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  FacebookPagesRepository,
  FacebookPagesService,
  type FacebookPageRow,
} from '../channel-facebook';
import {
  LEAD_SOURCE_DIRECTORY,
  type LeadSourceDirectoryPort,
} from '../leads/lead-source-directory.port';
import {
  NOT_A_META_SOURCE,
  toFormView,
  toFormViewFromRow,
  toPageView,
} from './meta-lead-ads.mapper';
import { MetaLeadAdsRepository, type FormRow } from './meta-lead-ads.repository';
import {
  classifyGraphError,
  clipError,
  leadAccessOf,
  sourceNameOf,
  sourceRefOf,
} from './meta-lead-rules';

const PAGES_MODULE = 'meta_lead_pages';
const FORMS_MODULE = 'meta_lead_forms';
const FB_MANAGE = 'fb.pages.manage';
const PROVIDER_KEY = 'Facebook';

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  details?: Array<{ path: string; message: string }>,
) => new AppError(ERROR_CODES[code], message, HttpStatus.UNPROCESSABLE_ENTITY, details);

/**
 * The management side of the Meta lead ads door (spec L-06, BL-011): which connected Pages have lead sync on, which of their lead
 * forms feed the lead pipeline, and the health of each. Every write is one transaction holding the change, its audit row and its outbox
 * event. The Page's token is read from the Facebook channel's sealed storage and used only for the call at hand; it is never returned.
 *
 * Receiving the leads (the webhook worker and the sweep) is `LeadgenService`; this class is what an admin's request reaches.
 */
@Injectable()
export class MetaLeadAdsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MetaLeadAdsRepository,
    private readonly pages: FacebookPagesRepository,
    private readonly login: FacebookPagesService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(FACEBOOK_GRAPH) private readonly facebook: FacebookGraphFactory,
    @Inject(META_LEAD_ADS_GRAPH) private readonly graph: MetaLeadAdsGraph,
    @Inject(LEAD_SOURCE_DIRECTORY) private readonly directory: LeadSourceDirectoryPort,
  ) {}

  // --- reads -----------------------------------------------------------------------------------------------------------------

  async overview(): Promise<MetaLeadAdsOverview> {
    const ctx = RequestContextStore.require();
    const cfg = this.login.connectConfig();
    const { fbPages, states, forms } = await this.db.tx(async (tx) => ({
      fbPages: await this.pages.list(tx, ctx.orgId),
      states: await this.repo.listPages(tx, ctx.orgId),
      forms: await this.repo.listForms(tx, ctx.orgId),
    }));
    const byPage = new Map(states.map((s) => [s.pageId, s]));
    const counts = new Map<string, number>();
    for (const f of forms) counts.set(f.pageId, (counts.get(f.pageId) ?? 0) + 1);
    return {
      configured: cfg.configured,
      webhookUrl: cfg.webhookUrl,
      verifyTokenConfigured: Boolean(this.facebook.settings.verifyToken),
      graphVersion: cfg.graphVersion,
      requiredScopes: [...META_LEAD_REQUIRED_SCOPES],
      usesLoginConfiguration: cfg.configId !== null,
      pages: fbPages.map((p) => toPageView(p, byPage.get(p.pageId), counts.get(p.pageId) ?? 0)),
    };
  }

  /** Health of one form's lead source, for the source's own screen. A source that is not a Meta lead form answers `connected: false`. */
  async sourceHealth(sourceUuid: string): Promise<MetaLeadSourceHealth> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const form = await this.repo.findFormBySourceUuid(tx, ctx.orgId, sourceUuid);
      if (!form) return NOT_A_META_SOURCE;
      const fb = await this.pages.findByPageId(tx, ctx.orgId, form.pageId);
      const st = await this.repo.findPage(tx, ctx.orgId, form.pageId);
      const view = fb ? toPageView(fb, st, 1) : undefined;
      return {
        connected: true,
        pageId: form.pageId,
        pageName: fb?.name ?? null,
        formId: form.formId,
        formName: form.name,
        pageRef: fb?.uuid ?? null,
        leadAccess: view?.leadAccess ?? null,
        // A Page that was disconnected from the Facebook channel has nothing left to receive from.
        state: view?.sync.state ?? 'needs_reconnect',
        subscribed: view?.sync.state === 'subscribed',
        lastLeadAt: form.lastLeadAt?.toISOString() ?? null,
        lastError: form.lastError ?? view?.sync.lastError ?? null,
      };
    });
  }

  // --- the connect (re-consent) login ------------------------------------------------------------------------------------------

  /**
   * The Facebook login that asks for the lead permissions, for a Page connected without them or one never connected. It is the
   * Facebook channel's own login (same sealed state, same callback address already registered in the Meta app), asked again with
   * `auth_type=rerequest`, and it sends the browser back here. Connecting a Page stores its token, so it also needs the Facebook
   * channel's own manage permission.
   */
  async startConnect(): Promise<MetaLeadConnectStart> {
    const ctx = RequestContextStore.require();
    if (ctx.grants?.get(FB_MANAGE)?.effect !== 'allow') throw AppError.forbidden(FB_MANAGE);
    if (!this.login.connectConfig().configured) {
      throw refuse(
        'MLA_NOT_CONFIGURED',
        'Meta is not configured on this install: an administrator has to add the Meta app.',
      );
    }
    return this.login.startLogin({
      extraScopes: META_LEAD_REQUIRED_SCOPES,
      rerequest: true,
      returnTo: 'lead-sources',
    });
  }

  // --- lead sync on a Page -----------------------------------------------------------------------------------------------------

  async enable(pageUuid: string): Promise<MetaLeadPage> {
    const ctx = RequestContextStore.require();
    const fb = await this.mustFindPage(ctx.orgId, pageUuid);
    this.assertReady(fb);
    const subscribed = await this.api(fb).subscribeLeadgen();
    if (!subscribed.ok)
      throw this.refusal(subscribed.code, subscribed.error, 'MLA_SUBSCRIBE_FAILED');
    if (!subscribed.data?.includes('leadgen')) {
      throw refuse(
        'MLA_SUBSCRIBE_FAILED',
        'Meta accepted the request but does not list the lead webhook field on this Page. Check the app has the leads_retrieval permission and the Page webhook is set up.',
      );
    }
    return this.db.tx(async (tx) => {
      const before = await this.repo.findPage(tx, ctx.orgId, fb.pageId);
      const state = await this.repo.enablePage(tx, ctx.orgId, fb.pageId, ctx.userId);
      await this.audit.record(tx, {
        module: PAGES_MODULE,
        recordId: state.id,
        action: before ? 'update' : 'insert',
        delta: { enabled: { old: before?.enabled ?? false, new: true } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: PAGES_MODULE,
        aggregateId: state.id,
        eventType: 'meta_lead_ads.page.enabled',
        payload: { uuid: fb.uuid, pageId: fb.pageId, name: fb.name },
      });
      return toPageView(fb, state, await this.formCount(tx, ctx.orgId, fb.pageId));
    });
  }

  async disable(pageUuid: string): Promise<MetaLeadPage> {
    const ctx = RequestContextStore.require();
    const fb = await this.mustFindPage(ctx.orgId, pageUuid);
    // Best effort: a revoked token must not keep lead sync on. Meta stops delivering when the field is gone, and our worker ignores a
    // Page that is off whatever Meta still sends.
    if (fb.status === 'connected')
      await this.api(fb)
        .unsubscribeLeadgen()
        .catch(() => undefined);
    return this.db.tx(async (tx) => {
      const state = await this.repo.disablePage(tx, ctx.orgId, fb.pageId);
      if (state) {
        await this.audit.record(tx, {
          module: PAGES_MODULE,
          recordId: state.id,
          action: 'update',
          delta: { enabled: { old: true, new: false } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: PAGES_MODULE,
          aggregateId: state.id,
          eventType: 'meta_lead_ads.page.disabled',
          payload: { uuid: fb.uuid, pageId: fb.pageId, name: fb.name },
        });
      }
      return toPageView(fb, state, await this.formCount(tx, ctx.orgId, fb.pageId));
    });
  }

  // --- forms ---------------------------------------------------------------------------------------------------------------------

  /**
   * The Page's lead forms as Meta lists them, each marked picked or not. Reading them uses the Page's token, so it needs the manage
   * permission. The questions and consent wording of forms already picked are refreshed here, so the mapping screen and the consent
   * proof follow an edit made at Meta.
   */
  async listForms(pageUuid: string): Promise<MetaLeadFormList> {
    const ctx = RequestContextStore.require();
    const fb = await this.mustFindPage(ctx.orgId, pageUuid);
    this.assertReady(fb);
    const listed = await this.api(fb).listForms();
    if (!listed.ok || !listed.data) {
      await this.noteMetaFailure(ctx.orgId, fb.pageId, listed.code, listed.error);
      throw this.refusal(listed.code, listed.error, 'MLA_FORMS_UNAVAILABLE');
    }
    const forms = listed.data;
    return this.db.tx(async (tx) => {
      const ours = await this.repo.listForms(tx, ctx.orgId, fb.pageId);
      const mine = new Map(ours.map((f) => [f.formId, f]));
      for (const f of forms) {
        const row = mine.get(f.id);
        if (row && changed(row, f)) {
          await this.repo.refreshForm(tx, ctx.orgId, fb.pageId, f.id, {
            name: f.name,
            status: f.status,
            locale: f.locale,
            questions: f.questions,
            checkboxes: f.checkboxes,
            privacyPolicyUrl: f.privacyPolicyUrl,
          });
        }
      }
      const listedIds = new Set(forms.map((f) => f.id));
      const data: MetaLeadForm[] = [
        ...forms.map((f) => toFormView(f, mine.get(f.id))),
        ...ours.filter((o) => !listedIds.has(o.formId)).map(toFormViewFromRow),
      ];
      const state = await this.repo.findPage(tx, ctx.orgId, fb.pageId);
      return { page: toPageView(fb, state, ours.length), data };
    });
  }

  /** Picks a form: its lead source is made (idempotent), its questions cached, and from now on its leads come in. */
  async connectForm(pageUuid: string, formId: string): Promise<MetaLeadForm> {
    const ctx = RequestContextStore.require();
    const fb = await this.mustFindPage(ctx.orgId, pageUuid);
    this.assertReady(fb);
    const state = await this.db.tx((tx) => this.repo.findPage(tx, ctx.orgId, fb.pageId));
    if (!state?.enabled) {
      throw refuse('MLA_SYNC_OFF', 'Turn on lead sync for this Page before choosing a form.');
    }
    const read = await this.api(fb).getForm(formId);
    if (!read.ok || !read.data) {
      // 100 = "no such object / not yours to see"; anything else is Meta being unreachable or refusing the token.
      if (read.code === 100 || read.code === 803) {
        throw refuse('MLA_FORM_NOT_FOUND', 'That form is not one of this Page’s lead forms.');
      }
      await this.noteMetaFailure(ctx.orgId, fb.pageId, read.code, read.error);
      throw this.refusal(read.code, read.error, 'MLA_FORMS_UNAVAILABLE');
    }
    const form = read.data;

    // The source first, in a transaction of its own (the directory opens one): a plan limit stops here, before anything is stored.
    const source = await this.directory.ensureConnectorSource(ctx.orgId, {
      kind: 'meta_lead_ads',
      providerKey: PROVIDER_KEY,
      externalRef: sourceRefOf(fb.pageId, form.id),
      name: sourceNameOf(fb.name, form.name),
    });
    return this.db.tx(async (tx) => {
      const before = await this.repo.findForm(tx, ctx.orgId, fb.pageId, form.id);
      await this.repo.upsertForm(tx, ctx.orgId, {
        pageId: fb.pageId,
        formId: form.id,
        name: form.name,
        status: form.status,
        locale: form.locale,
        questions: form.questions,
        checkboxes: form.checkboxes,
        privacyPolicyUrl: form.privacyPolicyUrl,
        sourceId: source.sourceId,
        connectedBy: ctx.userId,
      });
      const row = (await this.repo.findForm(tx, ctx.orgId, fb.pageId, form.id))!;
      if (!before) {
        await this.audit.record(tx, { module: FORMS_MODULE, recordId: row.id, action: 'insert' });
        await this.outbox.emit(tx, {
          aggregateModule: FORMS_MODULE,
          aggregateId: row.id,
          eventType: 'meta_lead_ads.form.connected',
          payload: {
            pageId: fb.pageId,
            formId: form.id,
            formName: form.name,
            sourceUuid: source.sourceUuid,
          },
        });
      }
      return toFormView(form, row);
    });
  }

  /** Stops bringing a form's leads in. Its lead source goes with it, and the leads stored under it; the contacts they made stay. */
  async disconnectForm(pageUuid: string, formId: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const fb = await this.mustFindPage(ctx.orgId, pageUuid);
    const row = await this.db.tx((tx) => this.repo.findForm(tx, ctx.orgId, fb.pageId, formId));
    if (!row) throw AppError.notFound('Lead form', formId);
    // Releasing the source deletes its row, and the form row with it (foreign key); the delete below covers a form row whose source
    // was already gone.
    await this.directory.releaseConnectorSource(ctx.orgId, sourceRefOf(fb.pageId, formId));
    await this.db.tx(async (tx) => {
      await this.repo.deleteForm(tx, ctx.orgId, fb.pageId, formId);
      await this.audit.record(tx, { module: FORMS_MODULE, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: FORMS_MODULE,
        aggregateId: row.id,
        eventType: 'meta_lead_ads.form.disconnected',
        payload: { pageId: fb.pageId, formId, formName: row.name },
      });
    });
  }

  // --- helpers -------------------------------------------------------------------------------------------------------------------

  private async mustFindPage(orgId: number, uuid: string): Promise<FacebookPageRow> {
    const page = await this.db.tx((tx) => this.pages.findByUuid(tx, orgId, uuid));
    if (!page) throw AppError.notFound('Facebook Page', uuid);
    return page;
  }

  /** The Page can be read from Meta: connected, with the lead permissions. Otherwise the person is told which step comes first. */
  private assertReady(fb: FacebookPageRow): void {
    if (!this.login.connectConfig().configured) {
      throw refuse(
        'MLA_NOT_CONFIGURED',
        'Meta is not configured on this install: an administrator has to add the Meta app.',
      );
    }
    if (fb.status !== 'connected') {
      throw refuse(
        'MLA_PAGE_RECONNECT',
        'This Page’s connection is no longer valid. Reconnect it to bring lead forms in.',
      );
    }
    const { access, missing } = leadAccessOf(fb.scopes);
    if (access === 'missing') {
      throw refuse(
        'MLA_LEAD_ACCESS_MISSING',
        'This Page was connected without permission to read lead forms. Grant lead access to continue.',
        missing.map((m) => ({ path: 'scopes', message: m })),
      );
    }
  }

  private api(fb: FacebookPageRow): MetaLeadAdsPageApi {
    return this.graph.forPage(this.crypto.decrypt(fb.accessToken ?? ''), fb.pageId);
  }

  private formCount(tx: Tx, orgId: number, pageId: string): Promise<number> {
    return this.repo.listForms(tx, orgId, pageId).then((rows) => rows.length);
  }

  /** What Meta's refusal means to the person: reconnect, grant access, or Meta's own words. */
  private refusal(
    code: number | undefined,
    message: string | undefined,
    otherwise: 'MLA_SUBSCRIBE_FAILED' | 'MLA_FORMS_UNAVAILABLE',
  ): AppError {
    const kind = classifyGraphError(code);
    if (kind === 'token') {
      return refuse(
        'MLA_PAGE_RECONNECT',
        'Meta no longer accepts this Page’s token. Reconnect the Page.',
      );
    }
    if (kind === 'permission') {
      return refuse(
        'MLA_LEAD_ACCESS_MISSING',
        'Meta refused: the Page lacks a lead permission. Grant lead access to continue.',
      );
    }
    return refuse(otherwise, clipError(message) ?? 'Meta did not answer. Try again in a moment.');
  }

  /** A failure on a Page with lead sync on is kept on the Page, so the screen shows it until the next success. */
  private async noteMetaFailure(
    orgId: number,
    pageId: string,
    code: number | undefined,
    message: string | undefined,
  ): Promise<void> {
    const kind = classifyGraphError(code);
    if (kind === 'transient') return;
    await this.db.tx((tx) =>
      this.repo.recordPageError(
        tx,
        orgId,
        pageId,
        kind,
        clipError(message) ?? 'Meta refused the request.',
      ),
    );
  }
}

/** The cached copy of a picked form differs from what Meta lists now. */
function changed(row: FormRow, f: LeadForm): boolean {
  return (
    row.name !== f.name ||
    row.status !== f.status ||
    JSON.stringify(row.questions) !== JSON.stringify(f.questions) ||
    JSON.stringify(row.checkboxes) !== JSON.stringify(f.checkboxes)
  );
}
