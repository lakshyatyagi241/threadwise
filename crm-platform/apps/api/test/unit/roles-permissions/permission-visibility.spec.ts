import { describe, expect, it, vi } from 'vitest';
import { PermissionsController } from '../../../src/modules/admin/permissions/permissions.controller';

const rows = [
  { key: 'record.contacts.read', label: 'View contacts', category: 'crm', supportsScope: true, planFeature: null, appSlug: null },
  { key: 'record.appointments.read', label: 'View appointments', category: 'crm', supportsScope: true, planFeature: 'appointment_booking', appSlug: null },
  { key: 'app.google-sheets.use', label: 'Use the Google Sheets add-on', category: 'marketplace', supportsScope: false, planFeature: null, appSlug: 'google-sheets' },
];

function controller(featureOn: boolean, installed: string[] = []) {
  const db = { txAs: undefined as unknown, tx: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ select: () => ({ from: async () => rows }) })) };
  const txAs = vi.fn(async (_c: unknown, fn: (tx: unknown) => unknown) =>
    fn({ select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => installed.map((slug) => ({ slug })) }) }) }) }),
  );
  const entitlements = { featureEnabled: vi.fn(async () => featureOn) };
  return {
    entitlements,
    controller: new PermissionsController({ ...db, txAs } as never, entitlements as never),
  };
}

describe('Roles editor permission list', () => {
  it('hides an add-on key when the workspace does not have the add-on', async () => {
    const { controller: c, entitlements } = controller(false);
    const { data } = await c.list({ orgId: 7 } as never);
    expect(data.map((d) => d.key)).toEqual(['record.contacts.read']);
    // the Sheets key stays hidden too: the app is not installed
    expect(entitlements.featureEnabled).toHaveBeenCalledWith(7, 'appointment_booking');
  });

  it('shows the add-on key once the workspace has the add-on', async () => {
    const { controller: c } = controller(true);
    const { data } = await c.list({ orgId: 7 } as never);
    expect(data.map((d) => d.key)).toEqual(['record.contacts.read', 'record.appointments.read']);
  });

  it('shows an app key only once the app is installed in the workspace', async () => {
    const { controller: c } = controller(false, ['google-sheets']);
    const { data } = await c.list({ orgId: 7 } as never);
    expect(data.map((d) => d.key)).toEqual(['record.contacts.read', 'app.google-sheets.use']);
  });
});
