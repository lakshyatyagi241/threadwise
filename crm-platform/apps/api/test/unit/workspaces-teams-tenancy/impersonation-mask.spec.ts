import { describe, expect, it } from 'vitest';
import { sessionResponseSchema } from '@crm/contracts';
import { maskPersonalData } from '../../../src/modules/auth/guards/impersonation-mask.interceptor';
import { impersonationVerdict } from '../../../src/modules/auth/guards/impersonation-rules';

describe('act-as PII masking and export block', () => {
  it('masks phone, email, name and text but keeps ids and shape', () => {
    const out = maskPersonalData({
      id: 'abc',
      items: [
        { phone: '+919876543210', email: 'jane@acme.com', fullName: 'Jane Doe', notes: 'secret' },
      ],
    }) as { id: string; items: Array<Record<string, string>> };
    expect(out.id).toBe('abc');
    expect(out.items[0]).toEqual({
      phone: '+91 ******210',
      email: 'j***@acme.com',
      fullName: 'J*** D***',
      notes: '[hidden text]',
    });
  });

  it('leaves the permission map alone: its keys name rights (phone, mail, note) but its values are grant scopes', () => {
    const body = {
      user: { email: 'jane@acme.com', fullName: 'Jane Doe' },
      permissions: {
        'contacts.phone.reveal': 'all',
        'inbox.conversation.note': 'team',
        'mail.mailboxes.read': 'own',
        'record.contacts.read': 'all',
      },
    };
    const out = maskPersonalData(body) as typeof body;
    expect(out.permissions).toEqual(body.permissions);
    // the person's own details are still masked
    expect(out.user).toEqual({ email: 'j***@acme.com', fullName: 'J*** D***' });
  });

  it('keeps the whole act-as session body valid for the web (its schema accepts only all, team or own)', () => {
    const body = {
      user: {
        id: 'd740783c-7cb9-40ed-88a4-c0b8280a8532',
        email: 'owner@acme.com',
        fullName: 'Owner Person',
        displayName: null,
        phone: null,
        locale: null,
        timezone: null,
        theme: 'paper',
        avatarUrl: null,
        emailVerified: true,
        mfaEnabled: false,
      },
      org: {
        id: '84560ab2-87d8-4e0a-9741-cb73a88f8b82',
        slug: 'acme',
        name: 'Acme',
        plan: 'starter',
        timezone: 'UTC',
        currency: null,
        messageFooter: null,
        onboardingStep: 'done',
      },
      roles: [{ id: '4cfb150f-fde4-474c-8050-a9349b3065d8', name: 'Owner' }],
      permissions: { 'contacts.phone.reveal': 'all', 'mail.settings.manage': 'all' },
      landing: 'dashboard',
      flags: {
        suspended: false,
        emailUnverified: false,
        emailBlocked: false,
        mfaEnrolmentRequired: false,
        passwordChangeRequired: false,
      },
      sessionId: '60ccc795-7859-43d1-ba63-24197dc6b9e0',
      effectiveTimezone: 'UTC',
    };
    const masked = maskPersonalData(body);
    const parsed = sessionResponseSchema.safeParse(masked);
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues)).toBe(true);
  });

  it('refuses exports and downloads even on GET', () => {
    for (const url of [
      '/v2/contacts/export',
      '/v2/contacts/exports/1/download',
      '/v2/flows/1/export',
    ]) {
      expect(impersonationVerdict(url, 'GET', false)).toBe('forbidden');
    }
    expect(impersonationVerdict('/v2/contacts', 'POST', true)).toBe('read_only');
  });
});
