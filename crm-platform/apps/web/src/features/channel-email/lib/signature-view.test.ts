import { describe, expect, it } from 'vitest';
import type { MailSignatureResponse } from '@crm/contracts';
import {
  autoSignature,
  canEditSignature,
  chosenSignature,
  pickable,
  signatureExtras,
  signaturePreviewHtml,
  variablesOf,
} from './signature-view';
import { composerErrorKey, isMailSendCode } from './composer-errors';
import { deliveryView } from './bounce-view';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MB = '33333333-3333-4333-8333-333333333333';
const sig = (id: string, p: Partial<MailSignatureResponse>): MailSignatureResponse => ({
  id,
  scope: 'user',
  mailboxId: null,
  userId: ME,
  name: id,
  bodyHtml: '<p>{{name}}</p>',
  bodyText: '',
  isDefault: false,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...p,
});

describe('signature resolution (the server order)', () => {
  const mine = sig('mine', { isDefault: true });
  const box = sig('box', { scope: 'mailbox', userId: null, mailboxId: MB, isDefault: true });
  const theirs = sig('theirs', { userId: OTHER, isDefault: true });

  it('prefers the sender default, then the mailbox default, then none', () => {
    expect(autoSignature([box, mine, theirs], MB, ME)?.id).toBe('mine');
    expect(autoSignature([box, theirs], MB, ME)?.id).toBe('box');
    expect(autoSignature([theirs], MB, ME)).toBeNull();
    expect(autoSignature([box], 'other-mailbox', ME)).toBeNull();
  });

  it('offers only the sender and mailbox signatures', () => {
    expect(pickable([box, mine, theirs], MB, ME).map((s) => s.id)).toEqual(['box', 'mine']);
  });

  it('turns the choice into reply fields and a preview', () => {
    const list = [mine, box];
    expect(signatureExtras({ kind: 'auto' })).toEqual({});
    expect(signatureExtras({ kind: 'none' })).toEqual({ signature: false });
    expect(signatureExtras({ kind: 'id', id: 'box' })).toEqual({ signatureId: 'box' });
    expect(chosenSignature({ kind: 'none' }, list, MB, ME)).toBeNull();
    expect(chosenSignature({ kind: 'id', id: 'box' }, list, MB, ME)?.id).toBe('box');
    expect(chosenSignature({ kind: 'auto' }, list, MB, ME)?.id).toBe('mine');
  });

  it('fills the variables and strips anything unsafe from the preview', () => {
    const vars = variablesOf({ fullName: 'Ada L', displayName: null, phone: '+44' });
    expect(signaturePreviewHtml(sig('s', {}), vars)).toBe('<p>Ada L</p>');
    const evil = sig('e', {
      bodyHtml: '<p>{{name}}<script>x()</script><img src=x onerror=y()></p>',
    });
    const out = signaturePreviewHtml(evil, {
      name: '<img src=x onerror=z()>',
      title: '',
      phone: '',
    });
    expect(out).not.toMatch(/<img|<script/i);
    expect(out).toContain('&lt;img');
  });

  it('lets an agent edit only their own user signatures', () => {
    const agent = { userId: ME, canManageSignatures: true, canManageMailboxes: false };
    expect(canEditSignature(mine, agent)).toBe(true);
    expect(canEditSignature(theirs, agent)).toBe(false);
    expect(canEditSignature(box, agent)).toBe(false);
    expect(canEditSignature(box, { ...agent, canManageMailboxes: true })).toBe(true);
    expect(canEditSignature(mine, { ...agent, canManageSignatures: false })).toBe(false);
  });
});

describe('composer errors', () => {
  it('maps the stable codes and ignores unknown ones', () => {
    expect(composerErrorKey('MAIL_RATE_LIMITED')).toBe('rateLimited');
    expect(composerErrorKey('MAIL_TOO_MANY_ATTACHMENTS')).toBe('tooManyAttachments');
    expect(composerErrorKey('SOMETHING')).toBeNull();
    expect(isMailSendCode('MAIL_RATE_LIMITED')).toBe(true);
    expect(isMailSendCode('NETWORK')).toBe(false);
  });
});

describe('deliveryView', () => {
  it('reports a bounce with its kind and the address', () => {
    expect(
      deliveryView({
        delivery: 'bounced',
        bounce: { kind: 'hard', reason: 'No such user', failedRecipient: 'x@y.io' },
      }),
    ).toEqual({ state: 'bounced', kind: 'hard', address: 'x@y.io', reason: 'No such user' });
    expect(deliveryView({ delivery: 'sent' })).toEqual({ state: 'ok' });
    expect(deliveryView({})).toEqual({ state: 'ok' });
  });
});
