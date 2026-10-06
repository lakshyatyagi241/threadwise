import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  EngineSenderRegistry,
  LinkTracker,
  PACING_SETTINGS,
  PacingRuntime,
  SENDER_DIRECTORY,
  SenderLease,
  TEMPLATE_DIRECTORY,
  WARMER_GATE,
  type OutgoingMessage,
} from '../../../src/modules/broadcasts';
import { MergeTagService } from '../../../src/modules/crm';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_SETTINGS,
} from '../../../src/modules/campaigns/_shims/tokens';
import { CampaignDispatchService } from '../../../src/modules/campaigns/campaign-dispatch.service';
import { CampaignEvents } from '../../../src/modules/campaigns/campaign-events';
import { CampaignJobs } from '../../../src/modules/campaigns/campaign-jobs';
import { CampaignMirrorService } from '../../../src/modules/campaigns/campaign-mirror.service';
import { CampaignReceiptsService } from '../../../src/modules/campaigns/campaign-receipts.service';
import { CampaignsRepository } from '../../../src/modules/campaigns/campaigns.repository';
import {
  FixtureEngineSender,
  type FixtureReceipt,
} from '../../../src/modules/campaigns/fixture/fixture-engine-sender';
import { WizardRetryService } from '../../../src/modules/campaigns/wizard/wizard-retry.service';
import { WizardRunService } from '../../../src/modules/campaigns/wizard/wizard-run.service';
import { WizardSeriesService } from '../../../src/modules/campaigns/wizard/wizard-series.service';
import { WizardTestSendService } from '../../../src/modules/campaigns/wizard/wizard-test-send.service';
import { WizardRepository } from '../../../src/modules/campaigns/wizard/wizard.repository';
import { WalletLedgerService } from '../../../src/modules/wallet-message-billing';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, bearer, startHarness, type Harness, type Tenant };

/** What the e2e specs of the broadcast wizard share: the services the worker would run, a clock, and a sandbox WhatsApp. */
export interface Lab {
  h: Harness;
  api: Api;
  runtime: PacingRuntime;
  /** The clock every service reads. */
  clock: { now: Date };
  /** Every message the sandbox accepted, in order. */
  sent: OutgoingMessage[];
  /** What the sandbox queued to report (delivery or failure), until `flush` applies it. */
  reports: FixtureReceipt[];
  dispatch: CampaignDispatchService;
  series: WizardSeriesService;
  retries: WizardRetryService;
  /** Applies the sandbox's queued reports the way the Cloud API webhook does. */
  flush(): Promise<number>;
  /** Runs a campaign now (what the BullMQ processor would do). */
  run(orgId: number, campaignId: number): Promise<string>;
  enqueued: Array<{ orgId: number; campaignId: number }>;
}

export function buildLab(h: Harness): Lab {
  const get = <T>(token: unknown) => h.app.get<T>(token as never, { strict: false });
  const runtime = get<PacingRuntime>(PacingRuntime);
  const clock = { now: new Date() };
  runtime.now = () => clock.now;
  runtime.sleep = () => Promise.resolve();
  runtime.random = () => 0.5;

  const sent: OutgoingMessage[] = [];
  const reports: FixtureReceipt[] = [];
  const sandbox = new FixtureEngineSender(
    {
      emit: (r) => {
        reports.push(r);
        return Promise.resolve();
      },
    },
    () => clock.now,
  );
  get<EngineSenderRegistry>(EngineSenderRegistry).register('waba', {
    open: async (orgId, sender) => {
      const opened = await sandbox.open();
      void orgId;
      void sender;
      return {
        send: async (m) => {
          const out = await opened.send(m);
          sent.push(m);
          return out;
        },
      };
    },
  });

  const enqueued: Array<{ orgId: number; campaignId: number }> = [];
  const jobs = new CampaignJobs({
    add: (_n: string, data: { orgId: number; campaignId: number }) => {
      enqueued.push(data);
      return Promise.resolve();
    },
  } as never);
  const db = get<DatabaseService>(DatabaseService);
  const repo = get<CampaignsRepository>(CampaignsRepository);
  const events = get<CampaignEvents>(CampaignEvents);
  const wizardRepo = get<WizardRepository>(WizardRepository);
  const engines = get<EngineSenderRegistry>(EngineSenderRegistry);
  const merge = get<MergeTagService>(MergeTagService);
  const tracker = get<LinkTracker>(LinkTracker);

  const dispatch = new CampaignDispatchService(
    db,
    repo,
    get<CryptoService>(CryptoService),
    events,
    get<CampaignMirrorService>(CampaignMirrorService),
    engines,
    merge,
    tracker,
    runtime,
    get<SenderLease>(SenderLease),
    get(SENDER_DIRECTORY),
    get(TEMPLATE_DIRECTORY),
    get(WARMER_GATE),
    get(PACING_SETTINGS),
    get(CAMPAIGN_BILLING),
    get(CAMPAIGN_FLOW_STARTER),
    get(CAMPAIGN_SETTINGS),
  );
  const series = new WizardSeriesService(
    db,
    wizardRepo,
    repo,
    get<WizardRunService>(WizardRunService),
    jobs,
    runtime,
  );
  const retries = new WizardRetryService(
    db,
    repo,
    events,
    engines,
    merge,
    tracker,
    runtime,
    get(SENDER_DIRECTORY),
    get(TEMPLATE_DIRECTORY),
  );
  const receipts = get<CampaignReceiptsService>(CampaignReceiptsService);
  const tests = get<WizardTestSendService>(WizardTestSendService);

  return {
    h,
    api: new Api(h),
    runtime,
    clock,
    sent,
    reports,
    dispatch,
    series,
    retries,
    enqueued,
    run: (orgId, campaignId) =>
      RequestContextStore.run(
        {
          requestId: `camp-${campaignId}`,
          orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () => dispatch.run(orgId, campaignId),
      ),
    async flush() {
      const batch = reports.splice(0, reports.length);
      for (const r of batch) {
        const receipt = {
          providerMessageId: r.providerMessageId,
          status: r.status,
          occurredAt: new Date(r.occurredAt),
          errorCode: r.errorCode ?? null,
          errorMessage: r.errorMessage ?? null,
        };
        (await receipts.handle(receipt)) || (await tests.handleReceipt(receipt));
      }
      return batch.length;
    },
  };
}

// ------------------------------------------------------------------------------------------------ seeding

let seq = 0;
/** A valid Indian mobile number whose last four digits are `tail` (see the sandbox rules), unique per call. */
export const number = (tail = String(1000 + (seq++ % 8000))) =>
  `+9199${String(10_000 + seq).slice(-4)}${tail.padStart(4, '0')}`;

export interface World {
  t: Tenant;
  /** The connected WhatsApp number's uuid. */
  config: string;
  /** An approved marketing template with a `{{1}}` first-name placeholder, tied to that number. */
  template: string;
}

/** A tenant with a connected Cloud API number and an approved template that has one placeholder (`first_name`). */
export async function world(
  lab: Lab,
  label: string,
  o: { body?: string; variableMap?: unknown; category?: string } = {},
): Promise<World> {
  const t = await lab.api.signup(label);
  return { t, ...(await addSender(lab.h.owner, t, o)) };
}

export async function addSender(
  owner: Client,
  t: Tenant,
  o: { body?: string; variableMap?: unknown; category?: string } = {},
): Promise<{ config: string; template: string }> {
  const cfg = await owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, is_primary, connected_at)
     VALUES ($1, 'waba', 'connected', $2, 'Main number', true, now()) RETURNING id, uuid`,
    [t.orgId, `+1555${String(1_000_000 + (seq++ % 9_000_000))}`],
  );
  const tpl = await owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, language, meta_category, category,
                               provider_config_id, variable_map)
     VALUES ($1, $2, $3, 'standard', 'approved', 'en_US', $4, $4, $5, $6::jsonb) RETURNING uuid`,
    [
      t.orgId,
      `offer_${randomUUID().slice(0, 8)}`,
      o.body ?? 'Hi {{1}}, our offer is live.',
      o.category ?? 'marketing',
      cfg.rows[0].id,
      JSON.stringify(o.variableMap ?? { body: [{ num: 1, key: 'first_name', example: 'Asha' }] }),
    ],
  );
  return { config: cfg.rows[0].uuid as string, template: tpl.rows[0].uuid as string };
}

/** Contacts straight into the table, `named` with the first name `Person<i>`, numbers as given (or fresh ones). */
export function people(
  lab: Lab,
  t: Tenant,
  rows: Array<{
    name?: string;
    phone?: string | null;
    isUnsubscribed?: boolean;
    countryCode?: string;
    data?: Record<string, unknown>;
  }>,
) {
  return lab.api.seedContacts(
    t,
    rows.map((r, i) => ({
      name: r.name ?? `Person${i}`,
      phone: r.phone === undefined ? number() : r.phone,
      ...(r.isUnsubscribed ? { isUnsubscribed: true } : {}),
      ...(r.countryCode ? { countryCode: r.countryCode } : {}),
      ...(r.data ? { data: r.data } : {}),
    })),
  );
}

export async function group(owner: Client, t: Tenant, name: string, contactUuids: string[]) {
  const g = await owner.query(
    `INSERT INTO contact_groups (org_id, name) VALUES ($1, $2) RETURNING id, uuid`,
    [t.orgId, name],
  );
  for (const c of contactUuids) {
    await owner.query(
      `INSERT INTO contact_group_members (org_id, group_id, contact_id)
       SELECT $1, $2, id FROM contacts WHERE org_id = $1 AND uuid = $3`,
      [t.orgId, g.rows[0].id, c],
    );
  }
  return g.rows[0].uuid as string;
}

/** Puts money in the workspace's wallet and makes it pay per message, so an empty wallet blocks a launch. */
export async function payPerMessage(lab: Lab, t: Tenant, fundMinor: number): Promise<void> {
  await lab.h.owner.query(
    `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES ($1, true)
     ON CONFLICT (org_id) DO UPDATE SET bill_to_platform_credit = true`,
    [t.orgId],
  );
  if (fundMinor > 0) await fund(lab, t.orgId, fundMinor);
}

export async function fund(lab: Lab, orgId: number, minor: number): Promise<void> {
  const db = lab.h.app.get(DatabaseService, { strict: false });
  const ledger = lab.h.app.get(WalletLedgerService, { strict: false });
  await db.txAs({ orgId, userId: null }, (tx) =>
    ledger.post(tx, {
      orgId,
      unit: 'USD',
      type: 'topup',
      direction: 'in',
      amountMinor: minor,
      idempotencyKey: `fund:${orgId}:${randomUUID()}`,
      source: 'topup.conversion',
      description: 'Wallet top-up',
    }),
  );
}

export async function balanceMinor(lab: Lab, orgId: number): Promise<number> {
  const r = await lab.h.owner.query(
    `SELECT (balance * 100)::bigint AS minor FROM wallets WHERE org_id = $1`,
    [orgId],
  );
  return r.rows[0] ? Number(r.rows[0].minor) : 0;
}

// ------------------------------------------------------------------------------------------------ HTTP

export const wiz = (lab: Lab, token: string) => ({
  get: (path: string) => lab.api.http().get(`/v2/broadcast-wizard${path}`).set(bearer(token)),
  post: (path: string, body: object = {}) =>
    lab.api
      .http()
      .post(`/v2/broadcast-wizard${path}`)
      .set(bearer(token))
      .set('idempotency-key', randomUUID())
      .send(body),
  put: (path: string, body: object) =>
    lab.api.http().put(`/v2/broadcast-wizard${path}`).set(bearer(token)).send(body),
});

export const problem = (res: {
  body: { code?: string; errors?: Array<{ path: string; message: string }> };
}) => ({
  code: res.body.code,
  errors: res.body.errors ?? [],
});

/** The full draft the launch tests start from: name, template, a group, the first name mapped. */
export function readyDraft(w: World, groupId: string, o: Record<string, unknown> = {}) {
  return {
    name: 'Diwali offer',
    templateId: w.template,
    senderKey: `waba:${w.config}`,
    audience: { groupIds: [groupId], segmentIds: [], rules: null },
    variables: { 'body.1': { kind: 'field', field: 'first_name', fallback: 'there' } },
    schedule: { mode: 'now' },
    retries: { enabled: false },
    step: 4,
    ...o,
  };
}

/** Creates a draft over the API and returns it. */
export async function makeDraft(lab: Lab, w: World, draft: Record<string, unknown>) {
  const res = await wiz(lab, w.t.admin).post('/drafts', draft);
  if (res.status !== 201) throw new Error(`draft ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as {
    id: string;
    rowVersion: number;
    status: string;
    draft: Record<string, unknown>;
  };
}

export const idOfCampaign = async (owner: Client, uuid: string) => {
  const r = await owner.query(`SELECT id, org_id FROM wpcampaigns WHERE uuid = $1`, [uuid]);
  return { id: Number(r.rows[0].id), orgId: Number(r.rows[0].org_id) };
};
