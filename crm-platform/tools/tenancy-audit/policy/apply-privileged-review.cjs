// One-off: records the 2026-10-11 line-by-line review of the 60 privileged() files that were baseline-unreviewed.
// Run: node tools/tenancy-audit/policy/apply-privileged-review.cjs
// Method: four reviewers each read every privileged( call site and its callers; the three concrete defects were then re-checked
// against the code by hand before being fixed. "partial" = the reviewer could not trace every consumer; it stays visible in the report.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'privileged-allowlist.json');
const allow = JSON.parse(fs.readFileSync(file, 'utf8'));

const SWEEP =
  "worker/cron only (no controller reaches it); the privileged step selects or retires rows across tenants, per-row work is scoped by org_id and id or runs under that row's own txAs";
const LOOKUP =
  'pre-tenant lookup keyed by a high-entropy secret or hash; returns routing data; the org is set only after the secret verifies';
const PLATFORM = 'platform/operator data behind OperatorGuard routes; no tenant route reaches it';

const reviews = {
  'infra/db/database.service.ts': [
    'reviewed',
    'the privileged() definition itself; no caller-controlled input',
  ],
  'kernel/rbac/rbac.service.ts': [
    'reviewed',
    'org-keyed roles_version read/bump; callers pass the authenticated org; returns an integer for a cache key',
  ],
  'modules/auth/maintenance/auth-maintenance.service.ts': [
    'reviewed',
    'cron retention across tenants, intended',
  ],
  'modules/auth/platform/tenant-directory.ts': [
    'reviewed',
    'pre-tenant identity directory; every later step is gated by credentials. Informational: findOrgBySlug returns the org settings JSON, callers use it internally (confirm none returns the OrgRef to a client)',
  ],
  'modules/auth/platform/platform-store.ts': [
    'reviewed-partial',
    'one-line pass-through with 54 consumer files; the tenant-reachable ones were read (ai-models returns model names only, ai-usage tenant route stays on db.tx), the rest were not all opened',
  ],
  'modules/api-library/api-library-retention.service.ts': ['reviewed', SWEEP],
  'modules/appointments-booking/appointment-lifecycle-sweep.service.ts': ['reviewed', SWEEP],
  'modules/appointments-booking/appointment-reminder-sweep.service.ts': ['reviewed', SWEEP],
  'modules/broadcasts/broadcast-due.service.ts': ['reviewed', SWEEP],
  'modules/broadcasts/broadcast-resume.service.ts': [
    'reviewed',
    SWEEP +
      '; per-row work runs inside the privileged tx with explicit org_id predicates (weaker than txAs, no bug)',
  ],
  'modules/broadcasts/broadcast-retry-sweeper.service.ts': [
    'reviewed',
    SWEEP + '; explicit org_id predicates inside the privileged tx',
  ],
  'modules/campaigns/campaign-sweeper.service.ts': [
    'reviewed',
    SWEEP +
      '; hardening: resumeStalled/reconcileMetaBlocks rely on explicit org_id predicates rather than a tenant context',
  ],
  'modules/campaigns/wizard/wizard-retry.service.ts': ['reviewed', SWEEP],
  'modules/campaigns/wizard/wizard-series.service.ts': ['reviewed', SWEEP],
  'modules/catalog-products/catalog-sweeps.service.ts': ['reviewed', SWEEP],
  'modules/channel-facebook/page-health-sweep.service.ts': ['reviewed', SWEEP],
  'modules/channel-instagram/inbound.service.ts': [
    'reviewed',
    'existence check of workspace_id after a timing-safe check of the platform engine secret; returns no tenant data',
  ],
  'modules/channel-instagram/pull-sweep.service.ts': [
    'reviewed-partial',
    'selects distinct org ids and enqueues {orgId} jobs; the consuming PullService was not read',
  ],
  'modules/chat-conversations/media-fetch-recovery.service.ts': ['reviewed', SWEEP],
  'modules/chat-conversations/queued-message-recovery.service.ts': ['reviewed', SWEEP],
  'modules/chrome-extension-sheets-addon/sheets-key.guard.ts': [
    'reviewed',
    LOOKUP + ' (128-bit key, sha256, unique partial index, per-IP failure throttle)',
  ],
  'modules/crm/invoicing/invoice-overdue-sweep.service.ts': ['reviewed', SWEEP],
  'modules/crm/invoicing/recurring-invoices.service.ts': [
    'reviewed',
    'dueAcrossTenants returns {orgId,id}; each schedule runs under RequestContextStore.run + db.tx; tenant controller methods use db.tx',
  ],
  'modules/crm/sales-docs/sales-doc-expiry-sweep.service.ts': [
    'reviewed',
    SWEEP + '; hardening: per-org writes run under the privileged flag with explicit org_id',
  ],
  'modules/crm/segments/segment-count-sweep.service.ts': ['reviewed', SWEEP],
  'modules/crm/tasks/task-due-sweep.service.ts': ['reviewed', SWEEP],
  'modules/developer-rest-api-v1/auth/bearer-api-key.guard.ts': [
    'reviewed',
    LOOKUP +
      ' (unique key prefix, constant-time hash compare, status/expiry/owner checks, failure throttle)',
  ],
  'modules/faq-knowledge/faq-embed.worker.ts': [
    'reviewed',
    SWEEP + '; markStale is an intentional platform-wide model-change heal',
  ],
  'modules/faq-knowledge/faq-platform.service.ts': [
    'reviewed',
    PLATFORM + ' (FaqPlatformService is not exported from its module)',
  ],
  'modules/faq-knowledge/faq-retention.service.ts': ['reviewed', SWEEP],
  'modules/flow-builder-editor/flow-templates-admin.service.ts': [
    'reviewed',
    PLATFORM +
      ". Product decision TI-012: graphFrom copies ANY tenant's flow by uuid into a global starter template",
  ],
  'modules/flow-runtime-engine/runtime/flow-sweeper.service.ts': ['reviewed', SWEEP],
  'modules/flow-runtime-engine/triggers/schedule.sweeper.ts': [
    'reviewed-fixed',
    SWEEP +
      '. The claim UPDATE had no org_id predicate (TI-010); fixed to WHERE org_id = $1 AND id = $2',
  ],
  'modules/forms-builder/form-retention-sweep.service.ts': ['reviewed', SWEEP],
  'modules/leads/lead-retention-sweep.service.ts': ['reviewed', SWEEP],
  'modules/marketing-site-cms/cms-store.ts': [
    'reviewed-partial',
    PLATFORM + '; upload.service.ts also uses store.tx and its route guard was not traced',
  ],
  'modules/marketplace/inbound.worker.ts': ['reviewed', SWEEP],
  'modules/marketplace/pull.worker.ts': [
    'reviewed-partial',
    SWEEP + '; PullRunService was not read',
  ],
  'modules/marketplace/subscription-lifecycle.service.ts': [
    'reviewed',
    'worker sweep re-locks each row by org_id and id; cancelAllForApp and operator comp/cancel sit behind OperatorGuard + PlatformPermissionGuard',
  ],
  'modules/message-templates/template-sweep.processor.ts': ['reviewed', SWEEP],
  'modules/node-bridge-runtime/outbound/catalog-bridge.adapter.ts': [
    'reviewed-fixed',
    "device lookup by sender phone dropped its org filter when called from a worker (no request context), so it could pick another workspace's connected device with the same number (TI-008); now takes an explicit orgId and fails closed",
  ],
  'modules/node-bridge-runtime/runtime/device-runtime.service.ts': [
    'reviewed',
    'worker only; restore adopts each device under its own org, flipStale is an intentional global stale-device sweep',
  ],
  'modules/node-bridge-runtime/unofficial-workspaces.service.ts': ['reviewed', PLATFORM],
  'modules/notifications/notification-retention.service.ts': ['reviewed', SWEEP],
  'modules/notifications/push-subscriptions-prune.service.ts': ['reviewed', SWEEP],
  'modules/notifications/waiting-nudge.service.ts': ['reviewed', SWEEP],
  'modules/platform-infrastructure/observability/worker-heartbeat.service.ts': [
    'reviewed',
    'read-only count and lag on event_outbox; GET /ready exposes the platform-wide aggregate (no per-tenant data)',
  ],
  'modules/platform-payment-gateways/paygw.store.ts': [
    'reviewed-partial',
    'blanket wrapper with ~60 call sites; operator routes and signed/tokened public receivers read, not every site. The webhook subscription match fell back to the newest subscription on a shared plan id (TI-009); fixed in subscription-lifecycle.service.ts',
  ],
  'modules/plans-subscriptions-trials/plan-store.ts': [
    'reviewed',
    'operator consumers + worker; one tenant-request use: BillingService.change runs a privileged tx (statements all keyed by ctx.orgId). Design decision TI-011',
  ],
  'modules/platform-support-desk/support-store.ts': ['reviewed', PLATFORM],
  'modules/public-api/api-key.guard.ts': [
    'reviewed',
    LOOKUP +
      '. Hardening TI-013: error messages distinguish unknown / revoked / invalid before the secret verifies, and there is no failed-auth throttle (the v1 guard has one)',
  ],
  'modules/roles-permissions/platform-rbac.store.ts': [
    'reviewed-partial',
    PLATFORM +
      '; not every consumer of platform-rbac.service.tx was traced (none touches tenant data)',
  ],
  'modules/scheduled-queue-warmer/scheduled-due.service.ts': ['reviewed', SWEEP],
  'modules/scheduled-queue-warmer/scheduled-receipts.service.ts': [
    'reviewed',
    'receipt lookup by provider message id in a worker; org derived from the matched row, writes under txAs. Hardening TI-014: relies on provider message ids being globally unique',
  ],
  'modules/shopify-woocommerce/platform-settings.service.ts': [
    'reviewed',
    PLATFORM + ' (aggregates only)',
  ],
  'modules/storefront-builder/recovery/cart-recovery-sweep.service.ts': ['reviewed', SWEEP],
  'modules/store-orders-sales/store-order-backfill.service.ts': [
    'reviewed',
    'operator CLI only; writes go through runInOrg + txAs',
  ],
  'modules/whatsapp-cloud-api-waba/waba-click-sync.service.ts': ['reviewed', SWEEP],
  'workers/outbox-drain.service.ts': [
    'reviewed-partial',
    "claims event_outbox rows, updates keyed by id + created_at, hands subscribers the row's orgId; each subscriber's own tenant context was not audited here",
  ],
  'workers/partition-maintenance.service.ts': [
    'reviewed',
    'catalog/schema objects only; no tenant rows',
  ],
};

let n = 0;
for (const [f, [status, reason]] of Object.entries(reviews)) {
  if (!allow[f]) throw new Error('not on the allowlist: ' + f);
  if (allow[f].status === 'reviewed') continue; // the 10 read earlier keep their own reason
  allow[f] = { status, reason, reviewedOn: '2026-10-11' };
  n++;
}
const left = Object.entries(allow)
  .filter(([, v]) => v.status === 'baseline-unreviewed')
  .map(([k]) => k);
fs.writeFileSync(file, JSON.stringify(allow, null, 1));
console.log('updated', n, 'still baseline-unreviewed:', left);
