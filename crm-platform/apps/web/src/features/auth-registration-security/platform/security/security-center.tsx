'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  securityOverviewResponseSchema,
  type DangerActionResponse,
  type SecurityOverviewResponse,
  type SecurityPolicy,
} from '@crm/contracts';
import { Alert, Button, Spinner, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { isRoleRefusal, rootPath } from '../lib/api-errors';
import { endsCallersSession, type DangerKind } from '../lib/danger';
import {
  FIELD_TAB,
  SECURITY_TABS,
  buildPolicyPatch,
  isPolicyKey,
  policyToDraft,
  type FieldProblem,
  type PolicyDraft,
} from '../lib/policy-draft';
import { useCanEdit } from '../operator-context';
import { operatorFetch } from '../operator-fetch';
import { PageHeader } from '../ui/page-header';
import { ReadOnlyNotice } from '../ui/read-only-notice';
import { TabBar } from '../ui/tab-bar';
import { ErrorBlock, LoadingBlock } from '../ui/state';
import { useToast } from '../ui/toast';
import { useUnsavedGuard } from '../ui/use-unsaved-guard';
import { DangerDialog } from './danger-dialog';
import { DangerPanel, HaltBanner } from './danger-panel';
import { AbusePanel, ApiPanel, DevicesPanel, LoginPanel, WhatsappPanel } from './policy-panels';
import { PolicyFormProvider, SECURITY_NS, fieldId } from './policy-form';
import { SecuritySearch } from './security-search';
import { KpiStrip, SummaryPanel } from './summary-panel';
import { useSecurityTab } from './use-security-tab';

export const SECURITY_QUERY_KEY = ['operator', 'security'] as const;

export function SecurityCenter() {
  const q = useQuery({
    queryKey: SECURITY_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/security', { schema: securityOverviewResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending)
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <SecurityCenterView overview={q.data} />;
}

type Errors = Partial<Record<keyof SecurityPolicy, string>>;

function SecurityCenterView({ overview }: { overview: SecurityOverviewResponse }) {
  const t = useTranslations(SECURITY_NS);
  const tp = useTranslations(`${SECURITY_NS}.problems`);
  const tc = useTranslations(`${SECURITY_NS}.controls`);
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCanEdit('policy');
  const { tab, setTab } = useSecurityTab();

  // Only what the person has touched is kept; every other control follows the stored policy, so a
  // refetch (after a danger action, say) never leaves the form holding stale values it did not change.
  const [edits, setEdits] = useState<Partial<PolicyDraft>>({});
  const draft = useMemo<PolicyDraft>(
    () => ({ ...policyToDraft(overview.policy), ...edits }),
    [overview.policy, edits],
  );
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{
    count: number;
    items: Array<{ key: string; message: string }>;
  } | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; requestId?: string } | null>(null);
  // The control to focus once its tab is on screen; the counter makes the effect run again for the same control.
  const focusKey = useRef<keyof SecurityPolicy | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [dangerKind, setDangerKind] = useState<DangerKind | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const { patch, problems: draftProblems } = useMemo(
    () => buildPolicyPatch(overview.policy, draft),
    [overview.policy, draft],
  );
  const changed = Object.keys(patch).length;
  // A control holding an invalid value counts as a pending edit too, so Save stays reachable to explain it.
  const dirty = changed + Object.keys(draftProblems).length;
  useUnsavedGuard(dirty > 0);

  function setField<K extends keyof PolicyDraft>(key: K, value: PolicyDraft[K]) {
    setEdits((e) => ({ ...e, [key]: value }));
    setErrors((e) => (key in e ? { ...e, [key]: undefined } : e));
  }

  function problemText(p: FieldProblem): string {
    switch (p.code) {
      case 'range':
        return p.allowZero
          ? tp('rangeWithZero', { min: p.min, max: p.max })
          : tp('range', { min: p.min, max: p.max });
      case 'tooMany':
        return tp('tooMany', { max: p.max });
      case 'tooLong':
        return tp('tooLong', { max: p.max });
      case 'totalTooLong':
        return tp('totalTooLong', { max: p.max });
      case 'invalidEntry':
        return tp('invalidEntry', { entry: p.entry });
    }
  }

  function reveal(keys: Array<keyof SecurityPolicy>) {
    const first = keys[0];
    if (!first) return;
    setTab(FIELD_TAB[first]);
    focusKey.current = first;
    setFocusTick((n) => n + 1);
  }

  // After a failed save, bring the first rejected control's tab to the front and focus it.
  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    const el = document.getElementById(fieldId(key));
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
      focusKey.current = null;
    }
  }, [focusTick, tab]);

  const save = useMutation({
    mutationFn: (body: typeof patch) =>
      operatorFetch('/security/policy', {
        method: 'PATCH',
        body,
        schema: securityOverviewResponseSchema,
      }),
    onSuccess: (data, body) => {
      qc.setQueryData(SECURITY_QUERY_KEY, data);
      setEdits({});
      setErrors({});
      setBanner(null);
      setSaveError(null);
      toast.success(t('saved', { count: Object.keys(body).length }));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const next: Errors = {};
        const items: Array<{ key: string; message: string }> = [];
        for (const fe of err.fieldErrors) {
          const key = rootPath(fe.path);
          items.push({ key, message: fe.message });
          if (isPolicyKey(key) && !next[key]) next[key] = fe.message;
        }
        setErrors(next);
        setSaveError(null);
        setBanner({ count: Math.max(1, err.fieldErrors.length), items });
        reveal(Object.keys(next).filter(isPolicyKey));
      } else if (isRoleRefusal(err)) {
        setSaveError({ message: t('errors.forbidden'), requestId: err.requestId });
      } else if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        /* operatorFetch is already sending the person to sign in */
      } else {
        setSaveError({
          message: t('errors.unexpected'),
          requestId: err instanceof ApiError ? err.requestId : undefined,
        });
      }
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || save.isPending) return;
    const { patch: body, problems } = buildPolicyPatch(overview.policy, draft);
    const keys = Object.keys(problems) as Array<keyof SecurityPolicy>;
    if (keys.length > 0) {
      const next: Errors = {};
      for (const k of keys) next[k] = problemText(problems[k]!);
      setErrors(next);
      setSaveError(null);
      setBanner({ count: keys.length, items: keys.map((k) => ({ key: k, message: next[k]! })) });
      reveal(keys);
      return;
    }
    if (Object.keys(body).length === 0) return;
    setErrors({});
    setBanner(null);
    save.mutate(body);
  }

  function discard() {
    setEdits({});
    setErrors({});
    setBanner(null);
  }

  const labelFor = (key: string) => (tc.has(`${key}.label`) ? tc(`${key}.label`) : key);

  const onDangerDone = (result: DangerActionResponse) => {
    if (endsCallersSession(result.action)) {
      setSignedOut(true);
      return;
    }
    void qc.invalidateQueries({ queryKey: SECURITY_QUERY_KEY });
  };
  const closeDanger = () => {
    setDangerKind(null);
    if (signedOut) window.location.assign('/admin/login');
  };

  const tabItems = SECURITY_TABS.map((id) => ({ id, label: t(`tabs.${id}`) }));
  const panel =
    tab === 'summary' ? (
      <SummaryPanel overview={overview} onAction={setDangerKind} />
    ) : tab === 'login' ? (
      <LoginPanel />
    ) : tab === 'whatsapp' ? (
      <WhatsappPanel />
    ) : tab === 'abuse' ? (
      <AbusePanel />
    ) : tab === 'api' ? (
      <ApiPanel />
    ) : tab === 'devices' ? (
      <DevicesPanel />
    ) : (
      <DangerPanel overview={overview} onAction={setDangerKind} />
    );

  return (
    <PolicyFormProvider
      value={{
        base: overview.policy,
        draft,
        setField,
        readOnly: !canEdit,
        matrix: overview.enforcement,
        yourIp: overview.yourIp,
        errors,
      }}
    >
      {/* Outside the form: pressing Enter in the search box must never save the policy. */}
      <div className="mb-5">
        <SecuritySearch />
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <PageHeader
          eyebrow={t('kicker')}
          title={t('title')}
          description={t('description')}
          actions={
            <>
              <Link
                href="/admin/security/events"
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('viewEvents')}
              </Link>
              <Button type="submit" disabled={!canEdit || dirty === 0 || save.isPending}>
                {save.isPending && <Spinner label={t('saving')} />}
                {save.isPending ? t('saving') : t('save')}
              </Button>
            </>
          }
        />

        {overview.emergencyHalt && <HaltBanner onResume={() => setDangerKind('resume_sends')} />}

        {!canEdit && <ReadOnlyNotice section="policy" />}

        {banner && (
          <Alert tone="danger" className="space-y-2">
            <p className="font-semibold">{t('rejected', { count: banner.count })}</p>
            <ul className="list-disc space-y-0.5 ps-5 text-xs">
              {banner.items.map((i, n) => (
                <li key={`${i.key}-${n}`}>
                  <span className="font-medium">{labelFor(i.key)}</span>: {i.message}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {saveError && (
          <Alert tone="danger" className="space-y-1">
            <p>{saveError.message}</p>
          </Alert>
        )}

        <KpiStrip kpis={overview.kpis} />

        <TabBar
          items={tabItems}
          value={tab}
          onChange={setTab}
          label={t('tabsLabel')}
          idPrefix="security"
        />
        <div
          role="tabpanel"
          id="security-panel"
          aria-labelledby={`security-tab-${tab}`}
          tabIndex={-1}
          className="outline-none"
        >
          {panel}
        </div>

        {/* Unsaved changes stay reachable on a long page and on a phone. */}
        <div
          className={cn(
            'sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-2.5 shadow-lg',
            dirty === 0 && 'hidden',
          )}
          aria-live="polite"
        >
          <span className="text-sm">{t('unsaved', { count: dirty })}</span>
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={discard} disabled={save.isPending}>
              {t('discard')}
            </Button>
            <Button type="submit" size="sm" disabled={!canEdit || save.isPending}>
              {save.isPending && <Spinner label={t('saving')} />}
              {t('save')}
            </Button>
          </span>
        </div>
      </form>

      <DangerDialog kind={dangerKind} onClose={closeDanger} onDone={onDangerDone} />
    </PolicyFormProvider>
  );
}
