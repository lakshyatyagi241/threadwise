import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { SessionResponse } from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { KEYS } from '../api/contacts';
import type { Owner } from '../api/owners';
import type { ContactRow } from '../api/schemas';
import { BulkUpdateDialog } from './bulk-update-dialog';
import { ContactFormModal } from './contact-form-modal';
import { OwnerControl } from './owner-control';

/** Owner field, Owner control on the profile and the Owner-only bulk update, in English and in Arabic (right to left). */

const FILES = [
  'contacts-attributes-tags.json',
  'auth-registration-security.account.json',
  'lead-scoring.json',
  'segments.json',
];
const read = (locale: string, file: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, file), 'utf8')) as Record<
    string,
    unknown
  >;
/** The domain's own messages plus the few other namespaces the form pulls in (phone field, lead score). */
const load = (locale: string) =>
  Object.assign({}, ...FILES.map((f) => read(locale, f))) as Record<string, unknown>;
const own = (locale: string) =>
  read(locale, 'contacts-attributes-tags.json')['contacts-attributes-tags'] as Record<
    string,
    Record<string, string>
  >;

const ME = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const MEERA = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';

const OWNERS: Owner[] = [
  { id: ME, fullName: 'Asha Rao', email: 'asha@x.test', canAssign: true },
  { id: RAVI, fullName: 'Ravi Nair', email: 'ravi@x.test', canAssign: true },
  // A person the caller's record scope does not reach: never offered, unless the contact already belongs to them.
  { id: MEERA, fullName: 'Meera Das', email: 'meera@x.test', canAssign: false },
];

const session = (permissions: string[]) =>
  ({
    user: { id: ME, email: 'asha@x.test', fullName: 'Asha Rao', displayName: null },
    org: { timezone: null },
    permissions: Object.fromEntries(permissions.map((p) => [p, 'all'])),
  }) as unknown as SessionResponse;

function render(el: ReactElement, opts: { locale?: string; owners?: Owner[] | null } = {}) {
  const locale = opts.locale ?? 'en';
  const qc = new QueryClient();
  if (opts.owners !== null) qc.setQueryData(KEYS.owners, opts.owners ?? OWNERS);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <SessionProvider session={session(['record.contacts.update', 'record.contacts.create'])}>
        <NextIntlClientProvider locale={locale} messages={load(locale)} timeZone="UTC">
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </NextIntlClientProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

const contact = (over: Partial<ContactRow> = {}) =>
  ({
    id: '294dca7c-5806-4548-9035-dcca9befc7b1',
    displayId: null,
    name: 'Aarav Sharma',
    firstName: 'Aarav',
    lastName: null,
    email: 'aarav@example.com',
    phone: null,
    companyId: null,
    ownerId: RAVI,
    lifecycleState: 'active',
    lifecycleStage: 'lead',
    status: null,
    source: null,
    customFields: {},
    isUnsubscribed: false,
    rowVersion: 4,
    createdAt: '2026-03-05T12:00:00.000Z',
    updatedAt: '2026-03-05T12:00:00.000Z',
    ...over,
  }) as unknown as ContactRow;

/** The `<option>` texts of the select with this id suffix, in order. */
function optionsOf(out: string, idSuffix: string): string[] {
  const m = new RegExp(`<select[^>]*id="[^"]*${idSuffix}"[^>]*>(.*?)</select>`, 's').exec(out);
  expect(m, `select ${idSuffix}`).not.toBeNull();
  return [...m![1]!.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((x) => x[1]!);
}

const NO_PHYSICAL = /\b(?:ml|mr|pl|pr)-\d|\b(?:left|right)-\d/;

describe('Owner field in the contact form', () => {
  it('a new contact starts owned by the person creating it, with Unassigned one choice away', () => {
    const out = render(<ContactFormModal open onClose={() => undefined} />);
    expect(out).toContain('>Owner<');
    expect(optionsOf(out, 'owner')).toEqual(['Unassigned', 'Asha Rao (me)', 'Ravi Nair']);
    expect(out).toMatch(new RegExp(`<option value="${ME}" selected`));
  });

  it('offers only people the caller may assign to, and keeps a current owner outside that reach', () => {
    const out = render(
      <ContactFormModal open contact={contact({ ownerId: MEERA })} onClose={() => undefined} />,
    );
    expect(optionsOf(out, 'owner')).toEqual([
      'Unassigned',
      'Asha Rao (me)',
      'Ravi Nair',
      'Meera Das',
    ]);
    expect(out).toMatch(new RegExp(`<option value="${MEERA}" selected`));
  });

  it('an owner who has left the workspace reads Former member instead of being dropped', () => {
    const out = render(
      <ContactFormModal open contact={contact({ ownerId: GONE })} onClose={() => undefined} />,
    );
    expect(optionsOf(out, 'owner')).toContain('Former member');
  });

  it('an unassigned contact opens on Unassigned', () => {
    const out = render(
      <ContactFormModal open contact={contact({ ownerId: null })} onClose={() => undefined} />,
    );
    expect(out).toMatch(/<option value="" selected/);
  });

  it('is translated and laid out for right to left in Arabic', () => {
    const ar = own('ar');
    const out = render(<ContactFormModal open onClose={() => undefined} />, { locale: 'ar' });
    expect(out).toContain(`>${ar.form!.owner}<`);
    expect(out).toContain(ar.form!.ownerNone);
    expect(out).not.toMatch(NO_PHYSICAL);
  });
});

describe('Owner on the contact profile', () => {
  const control = (canEdit: boolean, ownerId: string | null = RAVI) => (
    <OwnerControl contactId="c1" ownerId={ownerId} rowVersion={4} canEdit={canEdit} />
  );

  it('shows the name with an initials avatar and, for someone who may edit, a Change owner menu', () => {
    const editable = render(control(true));
    expect(editable).toContain('Ravi Nair');
    expect(editable).toContain('aria-haspopup="menu"');
    expect(render(control(false))).not.toContain('aria-haspopup');
    expect(render(control(false))).toContain('Ravi Nair');
  });

  it('says Unassigned, muted, when nobody owns the contact', () => {
    expect(render(control(false, null))).toContain('text-muted-foreground">Unassigned<');
  });

  it('reads Former member for an owner who is no longer in the workspace', () => {
    expect(render(control(false, GONE))).toContain('Former member');
  });

  it('Arabic uses logical spacing only', () => {
    const out = render(control(true), { locale: 'ar' });
    expect(out).not.toMatch(NO_PHYSICAL);
  });
});

describe('Update dialog on "all matching"', () => {
  const dialog = (over: { count: number | null; ownerOnly?: boolean }, locale = 'en') =>
    render(
      <BulkUpdateDialog
        open
        count={over.count}
        ownerOnly={over.ownerOnly}
        busy={false}
        onApply={async () => true}
        onClose={() => undefined}
      />,
      { locale },
    );

  it('offers only the owner when the selection is every contact a filter matches', () => {
    const out = dialog({ count: 320, ownerOnly: true });
    expect(out).toContain('>Owner<');
    expect(out).not.toContain('>Stage<');
    expect(out).not.toContain('>Status<');
    expect(out).not.toContain('Custom properties');
    expect(out).toContain('only the owner can be changed');
    expect(optionsOf(out, 'owner')).toEqual(['Keep', 'No owner', 'Asha Rao', 'Ravi Nair']);
  });

  it('keeps the full dialog for ticked rows', () => {
    const out = dialog({ count: 3 });
    expect(out).toContain('>Stage<');
    expect(out).toContain('>Status<');
  });

  it('titles an uncounted selection "all matching"', () => {
    expect(dialog({ count: null, ownerOnly: true })).toContain('Update all matching contacts');
  });

  it('is available in Arabic', () => {
    const ar = own('ar');
    const out = dialog({ count: null, ownerOnly: true }, 'ar');
    expect(out).toContain(ar.bulkUpdate!.titleAll);
    expect(out).toContain(ar.bulkUpdate!.ownerOnlyNote);
  });
});
