import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { OperatorCatalogueService } from '../../../src/modules/marketplace/operator-catalogue.service';
import { startHarness, type Harness } from './support';

/**
 * A client listing (the Chrome extension, the Google Sheets add-on) has no connector class, so publishing it must not look one up.
 * Both are seeded as drafts by the migrations; this publishes one as the operator console would.
 */
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 300_000);
afterAll(async () => {
  await h?.stop();
});

describe('publishing a client listing', () => {
  it('approves and publishes the seeded Google Sheets add-on', async () => {
    const catalogue = h.app.get(OperatorCatalogueService);
    const operator = (
      await h.owner.query(
        `SELECT id FROM platform_operators WHERE status = 'active' AND role = 'super_admin' ORDER BY id LIMIT 1`,
      )
    ).rows[0] as { id: string };
    const operatorId = Number(operator.id);

    await RequestContextStore.run(
      {
        requestId: 'client-listing-publish',
        orgId: 0,
        actorType: 'platform_operator',
        actorId: operatorId,
        userId: null,
        operatorRole: 'super_admin',
      },
      async () => {
        const draft = await catalogue.getApp('google-sheets');
        expect(draft.status).toBe('draft');
        const version = draft.versions[0]!;
        await catalogue.approve('google-sheets', version.id, {}, operatorId);
        await catalogue.publish('google-sheets', { versionId: version.id }, operatorId);
        expect((await catalogue.getApp('google-sheets')).status).toBe('published');
      },
    );
  });
});
