'use client';

import type { InvoiceProfile } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Button, ConfirmDialog, Spinner, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { KEYS, useInvoiceSettings } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { fieldErrors } from '../lib/errors';
import {
  countrySuggestion,
  diffToPatch,
  isDirty,
  profileToForm,
  validateForm,
  type ProfileForm,
} from '../lib/profile-form';
import { useLeaveGuard } from '../lib/use-leave-guard';
import { BrandingSection } from './business-profile-branding';
import { BusinessSection } from './business-profile-business';
import { DefaultsSection } from './business-profile-defaults';
import { GatewaySection } from './business-profile-gateway';
import { NumberingSection } from './business-profile-numbering';
import { PaymentSection } from './business-profile-payment';
import type { EditorCtx } from './business-profile-ui';
import { ErrorLine, useInvoicingCan } from './parts';

const SECTIONS = ['business', 'branding', 'payment', 'numbering', 'defaults', 'online'] as const;
/** The roots of the form's field paths: a server error under another path is shown in the bar, where the person will see it. */
const KNOWN_ROOTS = new Set<string>([
  'sellerName', 'sellerAddress', 'sellerCountry', 'sellerState', 'sellerTaxId', 'sellerRegistrationNo', 'sellerPhone', 'supportEmail',
  'extraFields', 'logoUrl', 'brandColor', 'invoiceTitle', 'footerNote', 'bankDetails', 'paymentInstructions', 'numberingPrefix',
  'proformaPrefix', 'receiptPrefix', 'creditNotePrefix', 'salesOrderPrefix', 'numberFormat', 'numberPadding', 'yearlyReset',
  'fiscalYearStartMonth', 'dueDays', 'terms', 'overdueReminders', 'defaultTaxRegime',
]);

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
      <path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M3 21h18M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1" />
    </svg>
  );
}

/** `/business-profile`: the invoicing settings of the workspace (seller identity, branding, bank details, numbering, defaults, online payment). */
export function BusinessProfileScreen() {
  const t = useTranslations('invoicing.settings');
  const can = useInvoicingCan();
  const query = useInvoiceSettings();
  const allowed = can.read || can.settings;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex items-center gap-4 rounded-xl border border-border bg-background px-4 py-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <BuildingIcon />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </header>

      {!allowed ? (
        <Alert tone="warning">{t('forbidden')}</Alert>
      ) : query.isPending ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-border bg-background p-6 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : query.isError ? (
        <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ProfileEditor profile={query.data} canEdit={can.settings} reload={() => query.refetch().then((r) => r.data ?? null)} />
      )}
    </div>
  );
}

function ProfileEditor({ profile, canEdit, reload }: { profile: InvoiceProfile; canEdit: boolean; reload: () => Promise<InvoiceProfile | null> }) {
  const t = useTranslations('invoicing.settings');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = useInvoicingCan();
  const rootRef = useRef<HTMLDivElement>(null);

  const [base, setBase] = useState(profile);
  const initial = useMemo(() => profileToForm(base), [base]);
  const [form, setForm] = useState<ProfileForm>(initial);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [gatewayDirty, setGatewayDirty] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const dirty = useMemo(() => isDirty(initial, form), [initial, form]);
  const guard = useLeaveGuard(dirty || gatewayDirty);
  const readOnly = !canEdit;

  // A newer profile arrives (another tab saved, a refetch): take it when nothing here is being edited.
  if (!dirty && profile.rowVersion !== base.rowVersion) {
    setBase(profile);
    setForm(profileToForm(profile));
  }

  const set = useCallback(<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    const root = key === 'bankRows' ? 'bankDetails' : key;
    setServerErrors((s) => {
      const keep = Object.entries(s).filter(([p]) => p !== root && !p.startsWith(`${root}.`));
      return keep.length === Object.keys(s).length ? s : Object.fromEntries(keep);
    });
    setConflict(false);
  }, []);

  const issues = useMemo(() => validateForm(form), [form]);
  const err = useCallback(
    (path: string): string | undefined => {
      const server = serverErrors[path];
      if (server) return server;
      const issue = issues[path];
      if (!issue || (issue.code === 'rowIncomplete' && !showAll)) return undefined;
      return t(`v.${issue.code}`, issue.params);
    },
    [issues, serverErrors, showAll, t],
  );
  const issueCount = Object.keys(issues).length;
  const unmapped = Object.entries(serverErrors).filter(([p]) => !KNOWN_ROOTS.has(p.split('.')[0] ?? ''));

  const suggestion = countrySuggestion(form.sellerCountry);
  const country = form.sellerCountry.trim().toUpperCase();
  const showSuggestion =
    !readOnly &&
    suggestion !== null &&
    dismissedFor !== country &&
    (suggestion.regime !== form.defaultTaxRegime || suggestion.fiscalYearStartMonth !== Number(form.fiscalYearStartMonth)) &&
    (country !== initial.sellerCountry.trim().toUpperCase() || form.defaultTaxRegime === 'none');

  const months = useMemo(() => {
    const m = suggestion?.fiscalYearStartMonth;
    return m ? new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1))) : '';
  }, [suggestion?.fiscalYearStartMonth, locale]);

  function focusFirstError() {
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  }

  async function save() {
    if (saving || readOnly) return;
    setShowAll(true);
    setError(null);
    if (issueCount > 0) {
      toast(t('fixFirst'), 'danger');
      focusFirstError();
      return;
    }
    const patch = diffToPatch(initial, form, base.rowVersion);
    if (Object.keys(patch).filter((k) => k !== 'rowVersion').length === 0) {
      // Only blank rows were added: nothing to send.
      setForm(initial);
      setShowAll(false);
      return;
    }
    setSaving(true);
    setServerErrors({});
    try {
      const next = await invoicingApi.updateSettings(patch);
      qc.setQueryData(KEYS.settings, next);
      setBase(next);
      setForm(profileToForm(next));
      setShowAll(false);
      setConflict(false);
      toast(t('saved'));
    } catch (e) {
      if (e instanceof ApiError && e.isRowVersionConflict) setConflict(true);
      else {
        setServerErrors(fieldErrors(e));
        setError(e);
        focusFirstError();
      }
    } finally {
      setSaving(false);
    }
  }

  async function reloadLatest() {
    const fresh = await reload();
    if (fresh) {
      setBase(fresh);
      setForm(profileToForm(fresh));
      setServerErrors({});
      setError(null);
      setShowAll(false);
    }
    setConflict(false);
  }

  const ctx: EditorCtx = { form, set, err, readOnly, profile: base };

  return (
    <div ref={rootRef} className="space-y-4">
      {readOnly && <Alert tone="info">{t('readOnly')}</Alert>}
      {base.rowVersion === null && <Alert tone="info">{t('notSavedYet')}</Alert>}

      <nav aria-label={t('menu')} className="thin-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {SECTIONS.map((s) => (
          <a
            key={s}
            href={`#${s}`}
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-border bg-background px-3.5 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t(`nav.${s}`)}
          </a>
        ))}
      </nav>

      <BusinessSection {...ctx} />

      {showSuggestion && suggestion && (
        <Alert tone="info" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium">{t('suggest.title', { country: suggestion.countryName })}</p>
            <p className="text-xs">{t('suggest.body', { taxLabel: suggestion.taxLabel, regime: suggestion.regime, month: months })}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="primary"
              className="h-10"
              onClick={() => {
                set('defaultTaxRegime', suggestion.regime);
                set('fiscalYearStartMonth', String(suggestion.fiscalYearStartMonth));
                setDismissedFor(country);
              }}
            >
              {t('suggest.apply')}
            </Button>
            <Button type="button" variant="secondary" className="h-10" onClick={() => setDismissedFor(country)}>
              {t('suggest.dismiss')}
            </Button>
          </div>
        </Alert>
      )}

      <BrandingSection {...ctx} />
      <PaymentSection {...ctx} />
      <NumberingSection {...ctx} />
      <DefaultsSection {...ctx} />
      <GatewaySection canEdit={canEdit} canView={can.settings} onDirty={setGatewayDirty} />

      {!readOnly && (
        <div className="sticky bottom-0 z-30 -mx-4 -mb-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mb-6 md:px-6">
          <div className="mx-auto max-w-5xl space-y-2">
            {conflict && (
              <Alert tone="danger" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{t('conflict.message')}</span>
                <span className="flex shrink-0 gap-2">
                  <Button type="button" variant="primary" size="sm" onClick={() => void reloadLatest()}>
                    {t('conflict.reload')}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setConflict(false)}>
                    {t('conflict.keep')}
                  </Button>
                </span>
              </Alert>
            )}
            {error !== null && !conflict && <ErrorLine error={error} />}
            {unmapped.length > 0 && (
              <Alert tone="danger">
                <ul className="list-disc ps-5 text-xs">
                  {unmapped.map(([p, m]) => (
                    <li key={p} dir="auto">
                      {m}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-sm" role="status">
                {saving ? (
                  <span className="text-muted-foreground">{t('saving')}</span>
                ) : issueCount > 0 && showAll ? (
                  <span className="text-danger">{t('issues', { count: issueCount })}</span>
                ) : dirty ? (
                  <span className="font-medium text-warning">{t('unsaved')}</span>
                ) : (
                  <span className="text-muted-foreground">{t('allSaved')}</span>
                )}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10"
                  disabled={!dirty || saving}
                  onClick={() => {
                    setForm(initial);
                    setServerErrors({});
                    setError(null);
                    setShowAll(false);
                  }}
                >
                  {t('discard')}
                </Button>
                <Button type="button" variant="primary" className="h-10 min-w-28" disabled={!dirty || saving} onClick={() => void save()}>
                  {saving && <Spinner />} {t('save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={guard.target !== null}
        title={t('leave.title')}
        message={t('leave.message')}
        confirmLabel={t('leave.leave')}
        cancelLabel={t('leave.stay')}
        tone="danger"
        onConfirm={guard.leave}
        onClose={guard.stay}
      />
    </div>
  );
}
