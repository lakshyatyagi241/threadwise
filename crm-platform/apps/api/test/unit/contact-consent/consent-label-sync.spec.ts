import { describe, expect, it, vi } from 'vitest';
import type { Tx } from '@crm/db';
import { ContactConsentService } from '../../../src/modules/contact-consent/consent.service';

/**
 * The Subscription status card reads the channel's label, the Consent card reads the ledger. A marketing grant from ANY path must
 * leave the label reading `subscribed`, or the two cards disagree (an import or a START keyword used to skip it).
 */
function make(prior?: { state: string }) {
  const repo = {
    lockState: vi.fn().mockResolvedValue(prior),
    insertEvent: vi.fn().mockResolvedValue({ id: 7, uuid: 'e7' }),
    upsertState: vi.fn().mockResolvedValue(undefined),
    anyWithdrawn: vi.fn().mockResolvedValue(false),
    setContactFlag: vi.fn().mockResolvedValue(false),
    contactUuid: vi.fn().mockResolvedValue('c-uuid'),
    setSubscribedStatus: vi.fn().mockResolvedValue({ from: null }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = { emit: vi.fn().mockResolvedValue(undefined) };
  const svc = new ContactConsentService(
    {} as never,
    repo as never,
    audit as never,
    outbox as never,
    {} as never,
  );
  return { svc, repo, audit };
}

const grant = (over: Record<string, unknown> = {}) => ({
  contactId: 5,
  channel: 'whatsapp' as const,
  action: 'granted' as const,
  source: 'import' as const,
  idempotencyKey: 'k1',
  ...over,
});

describe('ContactConsentService.recordInTx label sync', () => {
  it('sets the channel label to subscribed on a marketing grant, with an audit row', async () => {
    const { svc, repo, audit } = make();
    await svc.recordInTx({} as Tx, 1, grant());
    expect(repo.setSubscribedStatus).toHaveBeenCalledWith({}, 1, 5, 'whatsapp', null);
    expect(audit.record).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        module: 'contacts',
        delta: { whatsappSubscriptionStatus: { old: null, new: 'subscribed' } },
      }),
    );
  });

  it('does not touch the label on a withdrawal or a non-marketing grant', async () => {
    const a = make({ state: 'granted' });
    await a.svc.recordInTx({} as Tx, 1, grant({ action: 'withdrawn' }));
    expect(a.repo.setSubscribedStatus).not.toHaveBeenCalled();

    const b = make();
    await b.svc.recordInTx({} as Tx, 1, grant({ purpose: 'utility' }));
    expect(b.repo.setSubscribedStatus).not.toHaveBeenCalled();
  });

  it('writes nothing when the event was a duplicate', async () => {
    const { svc, repo } = make();
    repo.insertEvent.mockResolvedValue(null);
    await svc.recordInTx({} as Tx, 1, grant());
    expect(repo.setSubscribedStatus).not.toHaveBeenCalled();
  });
});
