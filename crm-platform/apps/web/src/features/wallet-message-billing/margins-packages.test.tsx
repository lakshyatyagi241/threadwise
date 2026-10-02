import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  saveWorkspaceMarginsSchema,
  type CreditPackage,
  type MarginRow,
  type MarginsResponse,
  type PricePreview,
  type RateRow,
  type WalletSettings,
} from '@crm/contracts';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { PackageForm } from './components/admin/package-form-page';
import { PackageTable } from './components/admin/packages-page';
import { filterCountries } from './components/admin/country-select';
import { MarginGrid, useMarginRows } from './components/admin/margin-grid';
import { PricingModeCard } from './components/admin/pricing-mode-card';
import { PreviewResult } from './components/admin/workspace-pricing';
import {
  EMPTY_MARGIN_DRAFT,
  addMarginRow,
  afterMarginSave,
  canSaveOverrides,
  editMarginField,
  marginGridRows,
  metaCostFor,
  planMarginSave,
  previewPrice,
  reasonProblem,
  stageRemoval,
  undoRemoval,
  type MarginDraft,
} from './lib/margin-grid';
import {
  bonusOf,
  checkPackage,
  emptyPackageDraft,
  packageSubmitError,
  toPackageDraft,
} from './lib/package-form';
import { modeChanged, pricingModeBody } from './lib/pricing-mode';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const raw = JSON.parse(
  readFileSync(
    join(resolve(__dirname, '../../..'), 'messages', 'en', 'wallet-message-billing.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const wrap = (el: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={raw} timeZone="UTC">
        <ToastProvider>{el}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const rate = (over: Partial<RateRow>): RateRow => ({
  id: ID(100),
  countryCode: '',
  countryName: '',
  category: '',
  priceMinor: 50,
  metaCost: null,
  marginMinor: null,
  currency: null,
  isActive: true,
  rowVersion: 1,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const margin = (over: Partial<MarginRow>): MarginRow => ({
  id: ID(1),
  countryCode: 'IN',
  countryName: 'India',
  category: 'marketing',
  marginBps: 2500,
  metaCost: '0.0250',
  priceMinor: 3,
  note: null,
  setBy: null,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'AE', name: 'United Arab Emirates' },
];

const marginsResponse = (
  data: MarginRow[],
  over: Partial<MarginsResponse> = {},
): MarginsResponse => ({
  scope: { type: 'platform' },
  pricingMode: 'margin',
  currency: 'USD',
  plans: [{ slug: 'pro', name: 'Pro' }],
  data,
  countries: COUNTRIES,
  ...over,
});

describe('margin price helpers', () => {
  it('prices a message as Meta cost x (1 + margin), rounded to the hundredth', () => {
    expect(previewPrice('0.5000', '25')).toEqual({ kind: 'ok', priceMinor: 63 });
    expect(previewPrice('1.0000', '12.5')).toEqual({ kind: 'ok', priceMinor: 113 });
    expect(previewPrice('1.0000', '0')).toEqual({ kind: 'ok', priceMinor: 100 });
  });

  it('charges at least 0.01 for a sub-cent cost, but nothing for a zero cost or a -100% margin', () => {
    expect(previewPrice('0.0010', '0')).toEqual({ kind: 'ok', priceMinor: 1 });
    expect(previewPrice('0', '25')).toEqual({ kind: 'ok', priceMinor: 0 });
    expect(previewPrice('0.5000', '-100')).toEqual({ kind: 'ok', priceMinor: 0 });
    expect(previewPrice('0.5000', '-50')).toEqual({ kind: 'ok', priceMinor: 25 });
  });

  it('parses the margin as at most 2 decimals from -100 to 1000, and reports a margin it cannot read', () => {
    expect(previewPrice('1.0', '-100.01').kind).toBe('invalid');
    expect(previewPrice('1.0', '1000.01').kind).toBe('invalid');
    expect(previewPrice('1.0', '12.345').kind).toBe('invalid');
    expect(previewPrice('1.0', '').kind).toBe('invalid');
    expect(previewPrice('1.0', 'abc').kind).toBe('invalid');
    expect(previewPrice('1.0', '1000')).toEqual({ kind: 'ok', priceMinor: 1100 });
  });

  it('has no price where Meta cost is unknown', () => {
    expect(previewPrice(null, '25')).toEqual({ kind: 'unknown' });
  });

  it('finds Meta cost like the billing engine: exact, country, category, then default; inactive rows are ignored', () => {
    const rates = [
      rate({ id: ID(1), countryCode: 'IN', category: 'marketing', metaCost: '0.0110' }),
      rate({ id: ID(2), countryCode: 'IN', category: '', metaCost: '0.0100' }),
      rate({ id: ID(3), countryCode: '', category: 'utility', metaCost: '0.0200' }),
      rate({ id: ID(4), countryCode: '', category: '', metaCost: '0.0300' }),
      rate({
        id: ID(5),
        countryCode: 'US',
        category: 'marketing',
        metaCost: '0.9',
        isActive: false,
      }),
    ];
    expect(metaCostFor(rates, 'IN', 'marketing')).toBe('0.0110');
    expect(metaCostFor(rates, 'in', 'utility')).toBe('0.0100');
    expect(metaCostFor(rates, 'US', 'utility')).toBe('0.0200');
    expect(metaCostFor(rates, 'US', 'marketing')).toBe('0.0300');
    expect(metaCostFor([rate({ countryCode: 'IN', metaCost: null })], 'IN', '')).toBeNull();
  });
});

describe('margin grid diff', () => {
  const server = [
    margin({ id: ID(1), countryCode: 'IN', category: 'marketing', marginBps: 2500 }),
    margin({ id: ID(2), countryCode: 'US', category: '', marginBps: 1000 }),
  ];
  const costOf = () => '0.0250';

  it('shows stored margins with two decimals and marks nothing dirty until a value really changes', () => {
    let d: MarginDraft = EMPTY_MARGIN_DRAFT;
    expect(marginGridRows(server, d, costOf).map((r) => [r.margin, r.dirty])).toEqual([
      ['25.00', false],
      ['10.00', false],
    ]);
    d = editMarginField(d, ID(1), 'margin', '25');
    expect(marginGridRows(server, d, costOf)[0]!.dirty).toBe(false);
    d = editMarginField(d, ID(1), 'margin', '30');
    expect(marginGridRows(server, d, costOf)[0]!.dirty).toBe(true);
  });

  it('sends only the changed and new rows, with the percent as typed', () => {
    let d = editMarginField(EMPTY_MARGIN_DRAFT, ID(2), 'margin', '-100');
    d = addMarginRow(d);
    d = editMarginField(d, 'new-1', 'countryCode', 'ae');
    d = editMarginField(d, 'new-1', 'category', 'utility');
    d = editMarginField(d, 'new-1', 'margin', ' 12.5 ');
    const plan = planMarginSave(marginGridRows(server, d, costOf));
    expect(plan.rows).toEqual([
      { countryCode: 'US', category: '', margin: '-100' },
      { countryCode: 'AE', category: 'utility', margin: '12.5' },
    ]);
    expect(plan.keys).toEqual([ID(2), 'new-1']);
    expect(plan.removeIds).toEqual([]);
    expect(plan.invalid).toEqual([]);
  });

  it('sends nothing for an untouched grid and ignores nothing else', () => {
    const plan = planMarginSave(marginGridRows(server, EMPTY_MARGIN_DRAFT, costOf));
    expect(plan).toMatchObject({ rows: [], keys: [], removeIds: [], invalid: [] });
  });

  it('holds back a bad percent and a new row that repeats a country and category', () => {
    let d = addMarginRow(EMPTY_MARGIN_DRAFT);
    d = editMarginField(d, 'new-1', 'countryCode', 'IN');
    d = editMarginField(d, 'new-1', 'category', 'marketing');
    d = editMarginField(d, 'new-1', 'margin', '5');
    d = addMarginRow(d);
    d = editMarginField(d, 'new-2', 'margin', '12.345');
    const plan = planMarginSave(marginGridRows(server, d, costOf));
    expect(plan.invalid).toEqual([
      { key: 'new-1', problem: 'duplicate' },
      { key: 'new-2', problem: 'margin' },
    ]);
    expect(plan.rows).toEqual([]);
  });

  it('keeps a skipped row with the server reason and clears the saved ones', () => {
    let d = editMarginField(EMPTY_MARGIN_DRAFT, ID(2), 'margin', '20');
    d = addMarginRow(d);
    d = editMarginField(d, 'new-1', 'margin', '7');
    const plan = planMarginSave(marginGridRows(server, d, costOf));
    const after = afterMarginSave(d, plan, {
      saved: 1,
      removed: 0,
      skipped: [{ index: 1, reason: 'Use a 2-letter country code' }],
    });
    expect(after.edits).toEqual({});
    expect(after.added.map((r) => r.key)).toEqual(['new-1']);
    expect(after.skipped).toEqual({ 'new-1': 'Use a 2-letter country code' });
    // editing the row clears its reason
    expect(editMarginField(after, 'new-1', 'margin', '8').skipped).toEqual({});
  });
});

describe('margin grid rendering', () => {
  function Harness({
    data,
    draft,
    skipped = {},
    audit = false,
    showProblems = false,
    canEdit = true,
  }: {
    data: MarginsResponse;
    draft: MarginDraft;
    skipped?: Record<string, string>;
    audit?: boolean;
    showProblems?: boolean;
    canEdit?: boolean;
  }) {
    const rows = useMarginRows(data, undefined, draft);
    return (
      <MarginGrid
        rows={rows}
        countries={data.countries}
        currency={data.currency}
        canEdit={canEdit}
        audit={audit}
        showProblems={showProblems}
        skipped={skipped}
        labelKey="Margins"
        onChange={() => undefined}
        onRemove={() => undefined}
        onUndo={() => undefined}
      />
    );
  }

  it('shows Meta cost and the live customer price, and a dash with the reason where cost is unknown', () => {
    const data = marginsResponse([
      margin({ id: ID(1), metaCost: '0.5000', marginBps: 2500 }),
      margin({ id: ID(2), countryCode: 'US', metaCost: null, priceMinor: null }),
    ]);
    const html = wrap(
      <Harness data={data} draft={editMarginField(EMPTY_MARGIN_DRAFT, ID(1), 'margin', '50')} />,
    );
    expect(html).toContain('$0.75');
    expect(html).toContain('$0.5000');
    expect(html).toContain('Meta&#x27;s cost is not known here, so the typed fixed price applies.');
    expect(html).toContain('value="50"');
    expect(html).toContain('Marketing');
  });

  it('shows each skipped reason on its own row', () => {
    const data = marginsResponse([margin({ id: ID(1) })]);
    let draft = addMarginRow(EMPTY_MARGIN_DRAFT);
    draft = editMarginField(draft, 'new-1', 'margin', '5');
    const html = wrap(
      <Harness
        data={data}
        draft={draft}
        skipped={{
          'new-1': 'Use a 2-letter country code',
          [ID(1)]: 'Repeated country and category: the first row was kept',
        }}
      />,
    );
    expect(html).toContain('Use a 2-letter country code');
    expect(html).toContain('Repeated country and category: the first row was kept');
    expect(html).toContain('role="alert"');
  });

  it('flags a bad margin on its row once save has been tried', () => {
    const data = marginsResponse([]);
    const draft = editMarginField(addMarginRow(EMPTY_MARGIN_DRAFT), 'new-1', 'margin', '12.345');
    const html = wrap(<Harness data={data} draft={draft} showProblems />);
    expect(html).toContain('Enter a percentage from -100 to 1000');
    expect(html).toContain('aria-invalid="true"');
  });

  it('offers a searchable country list that includes Any country', () => {
    const data = marginsResponse([]);
    const html = wrap(<Harness data={data} draft={addMarginRow(EMPTY_MARGIN_DRAFT)} />);
    expect(html).toContain('placeholder="Search countries"');
    expect(html).toContain('Any country');
    expect(html).toContain('India (IN)');
    expect(filterCountries(COUNTRIES, 'emir').map((c) => c.code)).toEqual(['AE']);
    expect(filterCountries(COUNTRIES, 'us').map((c) => c.code)).toEqual(['US']);
    expect(filterCountries(COUNTRIES, '')).toHaveLength(3);
  });

  it('shows the reason and who set a workspace override, and hides Remove from a read-only viewer', () => {
    const data = marginsResponse(
      [margin({ note: 'Negotiated contract', setBy: 'ops@example.com' })],
      {
        scope: { type: 'workspace', workspaceId: ID(9) },
      },
    );
    const editable = wrap(<Harness data={data} draft={EMPTY_MARGIN_DRAFT} audit />);
    expect(editable).toContain('Negotiated contract');
    expect(editable).toContain('ops@example.com');
    expect(editable).toContain('Remove: India (IN), Marketing');
    const readOnly = wrap(<Harness data={data} draft={EMPTY_MARGIN_DRAFT} audit canEdit={false} />);
    expect(readOnly).not.toContain('Remove: ');
    expect(readOnly).toContain('disabled=""');
  });

  it('marks a staged removal, with Undo', () => {
    const data = marginsResponse([margin({ id: ID(1) })]);
    const html = wrap(
      <Harness data={data} draft={stageRemoval(EMPTY_MARGIN_DRAFT, ID(1))} audit />,
    );
    expect(html).toContain('Will be removed when you save.');
    expect(html).toContain('Undo: India (IN), Marketing');
  });
});

describe('workspace override save', () => {
  const server = [margin({ id: ID(1) }), margin({ id: ID(2), countryCode: 'US', category: '' })];
  const costOf = () => '0.0250';
  const rowsOf = (d: MarginDraft) => marginGridRows(server, d, costOf);

  it('needs a reason of 5 to 500 characters once trimmed', () => {
    expect(reasonProblem('')).toBe('short');
    expect(reasonProblem('  abcd  ')).toBe('short');
    expect(reasonProblem('abcde')).toBeNull();
    expect(reasonProblem('x'.repeat(500))).toBeNull();
    expect(reasonProblem('x'.repeat(501))).toBe('long');
  });

  it('cannot be saved with nothing changed, or without a valid reason, even when something changed', () => {
    expect(canSaveOverrides(rowsOf(EMPTY_MARGIN_DRAFT), 'Plenty of reason').ok).toBe(false);
    const changed = editMarginField(EMPTY_MARGIN_DRAFT, ID(1), 'margin', '40');
    expect(canSaveOverrides(rowsOf(changed), '').ok).toBe(false);
    expect(canSaveOverrides(rowsOf(changed), 'abcd').ok).toBe(false);
    expect(canSaveOverrides(rowsOf(changed), 'Agreed in contract').ok).toBe(true);
  });

  it('a removal also needs the reason, and goes out as removeIds', () => {
    const d = stageRemoval(EMPTY_MARGIN_DRAFT, ID(2));
    expect(canSaveOverrides(rowsOf(d), 'no').ok).toBe(false);
    const { ok, plan } = canSaveOverrides(rowsOf(d), 'Contract ended');
    expect(ok).toBe(true);
    expect(plan.rows).toEqual([]);
    expect(plan.removeIds).toEqual([ID(2)]);
    // undoing the removal puts everything back
    expect(canSaveOverrides(rowsOf(undoRemoval(d, ID(2))), 'Contract ended').ok).toBe(false);
  });

  it('builds a body the API contract accepts: rows, removeIds and the trimmed note', () => {
    let d = stageRemoval(EMPTY_MARGIN_DRAFT, ID(2));
    d = editMarginField(d, ID(1), 'margin', '40');
    const { plan } = canSaveOverrides(rowsOf(d), 'Agreed in contract');
    const body = saveWorkspaceMarginsSchema.parse({
      rows: plan.rows,
      removeIds: plan.removeIds,
      note: '  Agreed in contract  ',
    });
    expect(body).toEqual({
      rows: [{ countryCode: 'IN', category: 'marketing', margin: '40' }],
      removeIds: [ID(2)],
      note: 'Agreed in contract',
    });
    expect(() =>
      saveWorkspaceMarginsSchema.parse({ rows: plan.rows, removeIds: [], note: '' }),
    ).toThrow();
  });

  it('a removed row is not also sent as an edit', () => {
    let d = editMarginField(EMPTY_MARGIN_DRAFT, ID(1), 'margin', '40');
    d = stageRemoval(d, ID(1));
    const { plan } = canSaveOverrides(rowsOf(d), 'Agreed in contract');
    expect(plan.rows).toEqual([]);
    expect(plan.removeIds).toEqual([ID(1)]);
  });

  it('after a save the staged removals are done and skipped rows keep their reason', () => {
    let d = stageRemoval(EMPTY_MARGIN_DRAFT, ID(2));
    d = addMarginRow(d);
    d = editMarginField(d, 'new-1', 'margin', '9');
    const { plan } = canSaveOverrides(rowsOf(d), 'Agreed in contract');
    const after = afterMarginSave(d, plan, {
      saved: 0,
      removed: 1,
      skipped: [{ index: 0, reason: 'Use a 2-letter country code' }],
    });
    expect(after.removed).toEqual([]);
    expect(after.skipped).toEqual({ 'new-1': 'Use a 2-letter country code' });
  });
});

describe('price preview result', () => {
  const preview = (over: Partial<PricePreview> = {}): PricePreview => ({
    mode: 'margin',
    currency: 'USD',
    country: 'IN',
    category: 'marketing',
    metaCost: '0.0250',
    marginBps: 2500,
    marginSource: 'plan',
    matchedMargin: 'IN|marketing',
    priceMinor: 3,
    basis: 'margin',
    matchedPrice: 'IN|marketing',
    planSlug: 'pro',
    ...over,
  });

  it('says which layer set the price and that a margin made it', () => {
    const html = wrap(<PreviewResult preview={preview()} />);
    expect(html).toContain('$0.0250');
    expect(html).toContain('25.00%');
    expect(html).toContain('Plan margin');
    expect(html).toContain('$0.03');
    expect(html).toContain('Meta cost + margin');
  });

  it('shows a fixed price with no margin layer', () => {
    const html = wrap(
      <PreviewResult
        preview={preview({
          mode: 'fixed',
          metaCost: null,
          marginBps: null,
          marginSource: null,
          matchedMargin: null,
          basis: 'fixed',
          priceMinor: 50,
        })}
      />,
    );
    expect(html).toContain('Not known');
    expect(html).toContain('No margin matched');
    expect(html).toContain('Fixed price');
    expect(html).toContain('$0.50');
  });
});

describe('pricing mode', () => {
  const settings = (over: Partial<WalletSettings> = {}): WalletSettings =>
    ({
      currency: 'USD',
      flatPriceMinor: 50,
      referralSignupMinor: 0,
      lowBalanceThresholdMinor: 500,
      perCountryEnabled: true,
      payPerMessage: true,
      pricingMode: 'fixed',
      metaRatesLive: false,
      updatedAt: null,
      ...over,
    }) as WalletSettings;

  it('is saved on its own: the body carries the mode and no other switch', () => {
    expect(pricingModeBody('margin')).toEqual({ pricingMode: 'margin' });
    expect(Object.keys(pricingModeBody('fixed'))).toEqual(['pricingMode']);
    expect(modeChanged('fixed', 'fixed')).toBe(false);
    expect(modeChanged('fixed', 'margin')).toBe(true);
  });

  it('offers both choices, says which is current, and confirms with what changes before saving', () => {
    const html = wrap(<PricingModeCard settings={settings()} canEdit />);
    expect(html).toContain('How customers are priced');
    expect(html).toContain('Fixed prices');
    expect(html).toContain('Meta cost + margin');
    expect(html).toContain('Current: Fixed prices');
    expect(html).toContain('id="pricing-mode"');
    expect(html).toContain('Change how customers are priced?');
    expect(html).toContain('Margins stay saved but stop applying.');
    expect(html).toContain('Save pricing mode');
    expect(html).toMatch(/value="fixed"[^>]*checked|checked[^>]*value="fixed"/);
  });

  it('is read-only for an operator who cannot write', () => {
    const html = wrap(
      <PricingModeCard settings={settings({ pricingMode: 'margin' })} canEdit={false} />,
    );
    expect(html).toContain('Current: Meta cost + margin');
    expect(html).toContain('Where Meta&#x27;s cost is unknown, the fixed price is still charged.');
    expect(html).not.toContain('Save pricing mode');
    expect(html).toContain('<fieldset');
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });
});

describe('package form', () => {
  const pkg = (over: Partial<CreditPackage> = {}): CreditPackage => ({
    id: ID(7),
    name: 'Starter',
    slug: 'starter',
    currency: 'USD',
    priceMinor: 10_000,
    walletCreditMinor: 12_000,
    bonusPercent: 20,
    badge: 'Best value',
    description: 'For small teams',
    isActive: true,
    isFeatured: false,
    sortOrder: 2,
    rowVersion: 3,
    ...over,
  });
  const filled = { ...emptyPackageDraft('USD'), name: 'Growth', price: '100', walletCredit: '120' };

  it('lets the slug stay blank and sends the rest', () => {
    const r = checkPackage(filled, ['USD', 'INR']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toMatchObject({
        name: 'Growth',
        slug: '',
        price: '100',
        walletCredit: '120',
        currency: 'USD',
        sortOrder: 0,
        isActive: true,
        isFeatured: false,
      });
      expect(r.input.rowVersion).toBeUndefined();
    }
  });

  it('refuses what the API would refuse and says which fields', () => {
    const bad = {
      ...filled,
      name: ' ',
      slug: 'has space',
      price: '1.234',
      walletCredit: '0',
      badge: 'b'.repeat(33),
      sortOrder: '10000',
      currency: 'XXX',
    };
    const r = checkPackage(bad, ['USD']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.problems).sort()).toEqual(
        ['badge', 'currency', 'name', 'price', 'slug', 'sortOrder', 'walletCredit'].sort(),
      );
    }
  });

  it('carries the row version when editing, read from the stored package', () => {
    const p = pkg();
    const r = checkPackage(toPackageDraft(p), ['USD'], p.rowVersion);
    expect(r.ok && r.input.rowVersion).toBe(3);
    expect(toPackageDraft(p)).toMatchObject({
      price: '100.00',
      walletCredit: '120.00',
      sortOrder: '2',
    });
  });

  it('turns a 409 into the stale-form state and a 422 into field marks, never by message text', () => {
    expect(
      packageSubmitError(new ApiError(409, 'ROW_VERSION_CONFLICT', 'anything at all')),
    ).toEqual({ kind: 'stale' });
    expect(
      packageSubmitError(
        new ApiError(422, 'VALIDATION_FAILED', 'x', 'req-1', [
          { path: 'walletCredit', message: 'Must be greater than 0' },
          { path: 'unknown', message: '?' },
        ]),
      ),
    ).toEqual({ kind: 'fields', problems: { walletCredit: true } });
    expect(packageSubmitError(new ApiError(500, 'INTERNAL', 'boom'))).toEqual({ kind: 'other' });
    expect(packageSubmitError(new Error('network'))).toEqual({ kind: 'other' });
  });

  it('has the friendly stale-form message', () => {
    const wallet = (
      raw['wallet-message-billing'] as {
        admin: { packages: { form: { stale: Record<string, string> } } };
      }
    ).admin.packages.form.stale;
    expect(wallet.title).toBe('This package was changed by someone else');
    expect(wallet.body).toContain('nothing was overwritten');
  });

  it('computes the bonus as credit above the price', () => {
    expect(bonusOf(10_000, 12_000)).toBe(20);
    expect(bonusOf(10_000, 10_000)).toBeNull();
    expect(bonusOf(0, 100)).toBeNull();
    expect(bonusOf(300, 400)).toBe(33.33);
  });

  it('renders the three sections with an optional slug, and the currencies from the list', () => {
    const html = wrap(
      <PackageForm
        existing={undefined}
        currencies={['USD', 'INR']}
        onReload={() => undefined}
        reloading={false}
      />,
    );
    for (const s of ['Identity', 'Pricing', 'Display']) expect(html).toContain(s);
    expect(html).toContain('Slug (optional)');
    expect(html).toContain('<option value="INR">INR</option>');
    expect(html).toContain('Create package');
    expect(html).not.toContain('changed by someone else');
  });

  it('fills the form from the stored package when editing', () => {
    const html = wrap(
      <PackageForm
        existing={pkg()}
        currencies={['USD']}
        onReload={() => undefined}
        reloading={false}
      />,
    );
    expect(html).toContain('value="Starter"');
    expect(html).toContain('value="100.00"');
    expect(html).toContain('Save changes');
    expect(html).toContain('A bonus of 20%');
  });
});

describe('package list', () => {
  const row = (over: Partial<CreditPackage> = {}): CreditPackage => ({
    id: ID(7),
    name: 'Starter',
    slug: 'starter',
    currency: 'USD',
    priceMinor: 10_000,
    walletCreditMinor: 12_000,
    bonusPercent: 20,
    badge: 'Best value',
    description: 'For small teams',
    isActive: true,
    isFeatured: true,
    sortOrder: 0,
    rowVersion: 1,
    ...over,
  });

  it('shows name and description, slug, price, credit with bonus, badge, status and the actions', () => {
    const html = wrap(
      <PackageTable
        rows={[
          row(),
          row({ id: ID(8), name: 'Old', isActive: false, badge: null, bonusPercent: 0 }),
        ]}
        canWrite
      />,
    );
    expect(html).toContain('For small teams');
    expect(html).toContain('starter');
    expect(html).toContain('$100.00');
    expect(html).toContain('$120.00');
    expect(html).toContain('+20% bonus');
    expect(html).toContain('Best value');
    expect(html).toContain('Active');
    expect(html).toContain('Inactive');
    expect(html).toContain('Featured');
    expect(html).toContain('Edit: Starter');
    expect(html).toContain('Disable: Starter');
    expect(html).toContain('Enable: Old');
    expect(html).toContain('Delete: Starter');
    expect(html).toContain('Delete this package? Existing purchases keep their ledger rows.');
  });

  it('has an empty state, and no actions for a read-only operator', () => {
    expect(wrap(<PackageTable rows={[]} canWrite />)).toContain('No credit packages yet');
    const html = wrap(<PackageTable rows={[row()]} canWrite={false} />);
    expect(html).not.toContain('Edit: Starter');
    expect(html).not.toContain('Delete: Starter');
  });
});
