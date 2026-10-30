import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Restricted access on campaigns (BL-430) is applied where a user-facing lookup passes a scope key, so a new file that reads
 * campaigns directly is unscoped until someone looks at it. This list is every file that reads `wpcampaigns` or its recipients today,
 * each already looked at (scoped, a worker or webhook, or a workspace-wide aggregate under its own permission). A new file fails here:
 * apply `campaignScopeSql` where a person's own list or detail is read, then add the file.
 */
const REVIEWED = [
  'modules/broadcasts/previous-sends.ts',
  'modules/broadcasts/tracking/link-redirect.service.ts',
  'modules/campaigns/campaign-mirror.service.ts',
  'modules/campaigns/campaign-sweeper.service.ts',
  'modules/campaigns/campaigns.repository.ts',
  'modules/campaigns/summary/campaign-summary.repository.ts',
  'modules/campaigns/wizard/wizard-follow-up.service.ts',
  'modules/campaigns/wizard/wizard-retry.service.ts',
  'modules/campaigns/wizard/wizard-rules.ts',
  'modules/campaigns/wizard/wizard.repository.ts',
  'modules/channel-sms/sms-senders.repository.ts',
  'modules/chat-conversations/message-history.query.ts',
  'modules/compliance-center/send-window.service.ts',
  'modules/dashboards-analytics-charts/dash-panels.repository.ts',
  'modules/growth-pilot/growth.repository.ts',
  'modules/lead-scoring/lead-scoring.repository.ts',
  'modules/notifications/send-outcome-notification.consumer.ts',
  'modules/privacy/manifests/engagement.ts',
  'modules/scheduled-queue-warmer/schedule-read.service.ts',
  'modules/wallet-message-billing/wallet-expenses.service.ts',
  'modules/wallet-message-billing/wallet-query.service.ts',
  'modules/whatsapp-cloud-api-waba/waba-click-sync.service.ts',
];

const SRC = join(__dirname, '../../../src');
function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith('.ts')) yield path;
  }
}

describe('files that read campaigns directly', () => {
  it('are all on the reviewed list', () => {
    const found = [...files(SRC)]
      .filter((f) => /wpcampaigns|wp_campaign_contacts/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split('\\').join('/'))
      .sort();
    expect(found).toEqual([...REVIEWED].sort());
  });
});
