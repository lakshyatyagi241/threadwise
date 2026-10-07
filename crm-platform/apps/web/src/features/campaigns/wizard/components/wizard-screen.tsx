'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { useContactFields, isUsableProperty } from '@/features/contacts-attributes-tags';
import { useUnsavedGuard } from '@/features/segments/components/use-unsaved-guard';
import { Alert, Button, ConfirmDialog, EmptyState } from '@crm/ui';
import type { WizardDraftResponse } from '@crm/contracts';
import {
  useAudienceCount,
  useAudienceSources,
  useCreditCheck,
  useWizardDraft,
  useWizardSenders,
  useWizardTemplates,
} from '../api/wizard';
import { countableAudience } from '../lib/audience';
import { decideNext, launchPreflight, previousStep } from '../lib/flow';
import { stepIssues, type IssueCode, type StepIssue } from '../lib/issues';
import type { LaunchFailure } from '../lib/launch-errors';
import { defaultTimeZone, launchKind } from '../lib/schedule';
import type { WizardView } from '../lib/state';
import { LaunchDialog } from './launch-dialog';
import { ErrorBlock, Skeleton } from './parts';
import { SaveIndicator } from './save-indicator';
import { StepAudience } from './step-audience';
import { StepReview } from './step-review';
import { StepSend } from './step-send';
import { StepTemplate } from './step-template';
import { Stepper } from './stepper';
import { statusPath, useLaunch } from './use-launch';
import { useSettled } from './use-settled';
import { useWizard } from './use-wizard';
import { WizardFooter } from './wizard-footer';

/** Problems that are a state of the data rather than a mistake: shown at once, not only after Next was pressed. */
const STATE_ISSUES: readonly IssueCode[] = [
  'no_recipients',
  'insufficient_balance',
  'checking_balance',
];

/** `/campaigns/wizard` and `/campaigns/wizard/[id]`: the four-step "Create broadcast" wizard. */
export function WizardScreen({ draftId }: { draftId?: string }) {
  const t = useTranslations('campaigns.wizard');
  const canCreate = useCan('camp.campaigns.create');
  const draft = useWizardDraft(draftId);

  if (!canCreate) {
    return (
      <Frame>
        <EmptyState title={t('noAccessTitle')} message={t('noAccess')} />
      </Frame>
    );
  }
  if (draftId) {
    if (draft.isPending) {
      return (
        <Frame>
          <Skeleton label={t('loading')} lines={6} />
        </Frame>
      );
    }
    if (draft.isError || !draft.data) {
      return (
        <Frame>
          <ErrorBlock error={draft.error} onRetry={() => void draft.refetch()} />
        </Frame>
      );
    }
    if (draft.data.status !== 'draft')
      return (
        <Frame>
          <LaunchedNotice id={draft.data.id} />
        </Frame>
      );
    return <WizardBody key={draft.data.id} initial={draft.data} />;
  }
  return <WizardBody initial={null} />;
}

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations('campaigns.wizard');
  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-10">
      <Link href="/campaigns" className="text-sm text-muted-foreground hover:underline">
        {t('backToCampaigns')}
      </Link>
      <h1 className="mb-5 mt-1 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      {children}
    </main>
  );
}

/** A draft that was already launched: read only, with the way to its status page. */
export function LaunchedNotice({ id }: { id: string }) {
  const t = useTranslations('campaigns.wizard');
  return (
    <EmptyState
      title={t('launchedTitle')}
      message={t('launchedBody')}
      actions={
        <Link
          href={statusPath(id)}
          className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
        >
          {t('viewStatus')}
        </Link>
      }
    />
  );
}

function WizardBody({ initial }: { initial: WizardDraftResponse | null }) {
  const t = useTranslations('campaigns.wizard');
  const ti = useTranslations('campaigns.wizard.issues');
  const ts = useTranslations('campaigns.wizard.steps');
  const w = useWizard(initial);
  const session = useSession();
  const canTest = useCan('camp.campaigns.test');
  const zone = defaultTimeZone(session.org.timezone);
  const { draft, view } = w.state;

  const templates = useWizardTemplates();
  const senders = useWizardSenders();
  const sources = useAudienceSources();
  const fields = useContactFields();
  const template = templates.data?.data.find((x) => x.id === draft.templateId) ?? null;
  const slots = useMemo(() => template?.slots.map((s) => s.slot) ?? [], [template]);
  const properties = useMemo(
    () => (fields.data ?? []).filter(isUsableProperty).map((f) => ({ key: f.key, label: f.label })),
    [fields.data],
  );

  // The number defaults to the workspace's default engine's first one; a draft whose number is gone gets the default again.
  const sendersList = senders.data?.data;
  const dispatch = w.dispatch;
  useEffect(() => {
    if (!sendersList || sendersList.length === 0) return;
    if (draft.senderKey && sendersList.some((x) => x.key === draft.senderKey)) return;
    const pick = sendersList.find((x) => x.isDefault) ?? sendersList[0]!;
    dispatch({ type: 'sender', senderKey: pick.key });
  }, [sendersList, draft.senderKey, dispatch]);

  const countable = countableAudience(draft.audience);
  const settled = useSettled(countable, 500);
  const count = useAudienceCount(view >= 2 ? settled.value : null);
  const credit = useCreditCheck(view >= 3 ? draft.templateId : null, countable ?? draft.audience);
  const countKnown = settled.settled && !count.isFetching && !count.isPlaceholderData;

  const now = new Date();
  const ctx = {
    slots,
    now,
    count: countKnown ? count.data : null,
    credit: credit.data,
    creditPending: view === 3 && Boolean(draft.templateId) && credit.isPending,
  };
  const issues = stepIssues(view, draft, ctx);

  const [attempted, setAttempted] = useState<Partial<Record<WizardView, boolean>>>({});
  const [notice, setNotice] = useState<LaunchFailure | null>(null);
  const visible: StepIssue[] = attempted[view]
    ? issues
    : issues.filter((i) => STATE_ISSUES.includes(i.code));
  const blocked = [...new Set(visible.map((i) => ti(i.code)))];

  const guard = useUnsavedGuard(w.unsaved);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) headingRef.current?.focus();
    mounted.current = true;
  }, [view]);

  const go = (step: WizardView) => {
    setNotice(null);
    w.dispatch({ type: 'go', step });
  };
  const openStep = async (step: WizardView) => {
    await w.flush();
    go(step);
  };

  const launch = useLaunch({
    id: w.id,
    rowVersion: w.rowVersion,
    release: guard.release,
    onFailure: (f) => {
      setNotice(f);
      if (f.kind === 'wallet') {
        void credit.refetch();
        go(3);
      } else if (f.kind === 'incomplete') {
        setAttempted((a) => ({ ...a, [f.step]: true }));
        go(f.step);
      }
    },
  });

  const onNext = async () => {
    const next = decideNext(view, issues);
    if (next.kind === 'blocked') {
      setAttempted((a) => ({ ...a, [view]: true }));
      return;
    }
    if (next.kind === 'launch') return startLaunch();
    if (!(await w.flush())) return;
    go(next.step);
  };

  const startLaunch = async () => {
    const check = launchPreflight(draft, ctx);
    if (check.kind === 'issues') {
      setAttempted((a) => ({ ...a, [check.step]: true }));
      if (check.step !== view) go(check.step);
      return;
    }
    if (!(await w.flush())) return;
    launch.show();
  };

  const recipients = credit.data?.recipients ?? count.data?.recipients;
  const skipped = count.data ? count.data.optedOut + count.data.invalidNumber : undefined;
  const stepKey = (['template', 'audience', 'review', 'send'] as const)[view - 1]!;

  return (
    <main className="w-full px-4 pt-3 sm:px-6 lg:px-10">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/campaigns" className="text-sm text-muted-foreground hover:underline">
            {t('backToCampaigns')}
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-4">
          <SaveIndicator status={w.status} onRetry={() => void w.flush()} />
          <WizardFooter
            step={view}
            launch={launchKind(draft.schedule)}
            busy={launch.busy}
            blocked={blocked}
            canLaunch
            onBack={() => void openStep(previousStep(view))}
            onNext={() => void onNext()}
          />
        </div>
      </div>

      <div className="my-3 shrink-0">
        <Stepper current={view} reached={draft.step} onGo={(s) => void openStep(s)} />
      </div>

      {w.status === 'conflict' && (
        <Alert tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span>{t('conflict')}</span>
          <Button size="sm" variant="secondary" onClick={() => void w.reload()}>
            {t('reload')}
          </Button>
        </Alert>
      )}
      {notice?.kind === 'wallet' && (
        <Alert tone="danger" className="mb-4">
          {t('launchWallet')}
        </Alert>
      )}
      {notice?.kind === 'incomplete' && (
        <Alert tone="danger" className="mb-4">
          <span className="block">{t('launchIncomplete')}</span>
          <ul className="mt-1 list-disc ps-5 text-sm">
            {notice.issues.map((i) => (
              <li key={`${i.path}-${i.code}`}>
                {knownIssue(i.code) ? ti(i.code as IssueCode) : i.code}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {notice?.kind === 'conflict' && (
        <Alert tone="warning" className="mb-4">
          {t('conflict')}
        </Alert>
      )}

      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        {ts(stepKey)}
      </h2>
      <p className="sr-only">{t(`stepHint.${stepKey}`)}</p>

      <div className="pb-6" key={w.epoch}>
        {view === 1 && (
          <StepTemplate
            name={draft.name}
            templateId={draft.templateId}
            noSender={sendersList !== undefined && sendersList.length === 0}
            senderName={sendersList?.find((x) => x.key === draft.senderKey)?.label ?? null}
            templates={templates}
            issues={visible}
            onName={(name) => w.dispatch({ type: 'name', name })}
            onTemplate={(tpl) => w.dispatch({ type: 'template', template: tpl })}
          />
        )}
        {view === 2 && (
          <StepAudience
            audience={draft.audience}
            sources={sources}
            count={count}
            countUpdating={!settled.settled}
            hasSource={countable !== null}
            issues={visible}
            template={template}
            senderName={sendersList?.find((x) => x.key === draft.senderKey)?.label ?? null}
            onAudience={(patch) => w.dispatch({ type: 'audience', patch })}
          />
        )}
        {view === 3 && (
          <StepReview
            draft={draft}
            template={template}
            sender={sendersList?.find((x) => x.key === draft.senderKey) ?? null}
            sources={sources.data}
            count={count.data}
            credit={credit}
            properties={properties}
            issues={issues}
            showIssues={Boolean(attempted[3])}
            onVariable={(slot, source) => w.dispatch({ type: 'variable', slot, source })}
            onVariables={(variables) => w.dispatch({ type: 'variables', variables })}
            onEdit={(s) => void openStep(s)}
          />
        )}
        {view === 4 && (
          <StepSend
            draft={draft}
            draftId={w.id}
            zone={zone}
            canTest={canTest}
            issues={visible}
            currency={credit.data?.currency ?? null}
            ensureSaved={w.flush}
            dispatch={w.dispatch}
          />
        )}
      </div>

      <LaunchDialog
        open={launch.open}
        busy={launch.busy}
        error={launch.error}
        draft={draft}
        template={template}
        credit={credit.data}
        recipients={recipients}
        skipped={skipped}
        onConfirm={() => void launch.confirm(t('launchFailed'))}
        onClose={launch.close}
      />
      <ConfirmDialog
        open={guard.pending !== null}
        tone="danger"
        title={t('leaveTitle')}
        message={t('leaveBody')}
        confirmLabel={t('leave')}
        cancelLabel={t('stay')}
        onClose={guard.stay}
        onConfirm={guard.leave}
      />
    </main>
  );
}

const KNOWN_ISSUES: ReadonlySet<string> = new Set([
  'name_required',
  'template_required',
  'audience_required',
  'variable_unmapped',
  'schedule_in_past',
  'schedule_end_before_start',
  'recurrence_invalid',
  'retry_end_required',
  'retry_end_before_send',
  'retry_end_in_past',
  'schedule_required',
  'no_recipients',
  'insufficient_balance',
  'checking_balance',
]);
const knownIssue = (code: string) => KNOWN_ISSUES.has(code);
