'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SenderHidden, WizardDraftResponse, WizardSender } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Field, Select, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { isUsableProperty, useContactFields } from '@/features/contacts-attributes-tags';
import { useUnsavedGuard } from '@/features/segments/components/use-unsaved-guard';
import { EMPTY_FORM } from '../lib/builder-model';
import { classicFallback } from '../lib/sender-empty';
import { WIZARD_STEPS, type WizardStep } from '../lib/wizard-model';
import {
  useAudienceCount,
  useAudienceSources,
  useCreditCheck,
  useWizardTemplates,
} from '../wizard/api/wizard';
import { AudienceBody } from '../wizard/components/step-audience';
import { CountPanel } from '../wizard/components/count-panel';
import { CreditCard } from '../wizard/components/credit-card';
import { LaunchDialog } from '../wizard/components/launch-dialog';
import { CardStyle } from '../wizard/components/parts';
import { RetriesCard } from '../wizard/components/retries-card';
import { SaveIndicator } from '../wizard/components/save-indicator';
import { ScheduleCard } from '../wizard/components/schedule-card';
import { SummaryCard } from '../wizard/components/summary-card';
import { TestSendCard } from '../wizard/components/test-send-card';
import { useLaunch } from '../wizard/components/use-launch';
import { useSettled } from '../wizard/components/use-settled';
import { useWizard } from '../wizard/components/use-wizard';
import { WizardFooter } from '../wizard/components/wizard-footer';
import { VariablesCard } from '../wizard/components/variables-card';
import { countableAudience } from '../wizard/lib/audience';
import { launchPreflight } from '../wizard/lib/flow';
import { stepIssues, type IssueCode, type StepIssue } from '../wizard/lib/issues';
import type { LaunchFailure } from '../wizard/lib/launch-errors';
import { defaultTimeZone, launchKind } from '../wizard/lib/schedule';
import type { WizardAction, WizardView } from '../wizard/lib/state';
import { previewModelOf } from '../wizard/lib/templates';
import { BuilderHeader } from './builder/header';
import { CostPanel } from './builder/cost-panel';
import { LivePreview } from './builder/live-preview';
import {
  AutoEndField,
  PACING_KEYS,
  SmartDelivery,
  TrackClicks,
  type PacingKey,
} from './builder/delivery-extras';
import { AbToggle, SetupFields, TypeCards } from './builder/step-setup';
import { Stepper } from './builder/stepper';
import { StepCard } from './builder/parts';

/** Problems that are a state of the data rather than a mistake: shown at once, not only after Next was pressed. */
const STATE_ISSUES: readonly IssueCode[] = [
  'no_recipients',
  'insufficient_balance',
  'checking_balance',
  'balance_unavailable',
];

/** The wallet check's own issues (the same codes the Review step blocks on). */
const BALANCE_CODES: readonly IssueCode[] = [
  'insufficient_balance',
  'checking_balance',
  'balance_unavailable',
];

/** The wizard view each builder step stands for (what `draft.step` records as the furthest reached). */
const VIEW_OF: Record<WizardStep, WizardView> = {
  setup: 1,
  compose: 1,
  recipients: 2,
  schedule: 3,
  review: 4,
};
/** Where "Edit" in the summary leads, by the wizard view that owns the row. */
const STEP_OF_VIEW: Record<WizardView, WizardStep> = {
  1: 'setup',
  2: 'recipients',
  3: 'compose',
  4: 'schedule',
};

/** The builder step that owns an issue, by the draft path it names. */
function stepOfIssue(path: string): WizardStep {
  const head = path.split('.')[0];
  if (head === 'name' || head === 'senderKey') return 'setup';
  if (head === 'templateId' || head === 'variables') return 'compose';
  if (head === 'audience') return 'recipients';
  if (head === 'credit') return 'review';
  return 'schedule';
}

/**
 * Campaigns, Create for a verified Meta (WhatsApp Cloud API) number: the campaign builder's own page, with its steps, header and live
 * preview, where the broadcast logic fills the sections. Setup holds the name and the number; Compose a template dropdown with the
 * variable mapping under it; Recipients the four ways to pick the audience with the live count; Schedule send now, later or on a rule
 * with retries; Review the cost, the summary and a test send, then the launch. Everything is a wizard draft (saved as you go), so
 * retries, recurring series, the credit gate and the sandbox work as for any guided send.
 */
export function GuidedCampaign({
  initial,
  senders,
  hidden,
  preferredSenderKey,
  initialName,
  onClassic,
}: {
  initial: WizardDraftResponse | null;
  /** The numbers on offer (all engines): picking one that is not a verified Meta number hands the screen to the classic builder. */
  senders: readonly WizardSender[];
  /** The numbers the server left out, so an empty list can say why. */
  hidden?: readonly SenderHidden[] | undefined;
  preferredSenderKey?: string | undefined;
  initialName?: string | undefined;
  onClassic: (senderKey: string, name: string) => void;
}) {
  const t = useTranslations('campaigns.builder');
  const tg = useTranslations('campaigns.builder.guided');
  const tw = useTranslations('campaigns.wizard');
  const ti = useTranslations('campaigns.wizard.issues');
  const { toast } = useToast();
  const w = useWizard(initial);
  const session = useSession();
  const canTest = useCan('camp.campaigns.test');
  const zone = defaultTimeZone(session.effectiveTimezone);
  const { draft } = w.state;

  const [step, setStep] = useState<WizardStep>('setup');
  const [attempted, setAttempted] = useState<Partial<Record<WizardStep, boolean>>>({});
  const [notice, setNotice] = useState<LaunchFailure | null>(null);
  const [switchTo, setSwitchTo] = useState<WizardSender | null>(null);

  const templates = useWizardTemplates();
  const sources = useAudienceSources();
  const fields = useContactFields();
  const properties = useMemo(
    () => (fields.data ?? []).filter(isUsableProperty).map((f) => ({ key: f.key, label: f.label })),
    [fields.data],
  );

  // The number: the draft's, else the one picked on the create screen, else the default verified one. The draft only learns it with the
  // first real change, so opening this flow does not leave an empty draft behind.
  const guided = useMemo(() => senders.filter((s) => s.guided), [senders]);
  const fallbackKey = (
    guided.find((s) => s.key === preferredSenderKey) ??
    guided.find((s) => s.isDefault) ??
    guided[0]
  )?.key;
  const senderKey =
    draft.senderKey && senders.some((s) => s.key === draft.senderKey)
      ? draft.senderKey
      : (fallbackKey ?? '');
  const sender = senders.find((s) => s.key === senderKey) ?? null;
  const dispatch = w.dispatch;
  const act = (a: WizardAction) => {
    if (draft.senderKey === null && senderKey !== '' && a.type !== 'sender')
      dispatch({ type: 'sender', senderKey });
    dispatch(a);
  };
  // A name typed before the switch comes along.
  useEffect(() => {
    if (!initial && initialName && draft.name === '') dispatch({ type: 'name', name: initialName });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The templates of the chosen number; a template the number cannot use is dropped.
  const usable = useMemo(
    () =>
      (templates.data?.data ?? []).filter(
        (x) => !x.senderLabel || !sender || x.senderLabel === sender.label,
      ),
    [templates.data, sender],
  );
  const template = usable.find((x) => x.id === draft.templateId) ?? null;
  useEffect(() => {
    if (templates.data && draft.templateId && !usable.some((x) => x.id === draft.templateId))
      dispatch({ type: 'template', template: null });
  }, [templates.data, usable, draft.templateId, dispatch]);
  const templateB = usable.find((x) => x.id === draft.templateIdB) ?? null;
  useEffect(() => {
    if (templates.data && draft.templateIdB && !usable.some((x) => x.id === draft.templateIdB))
      dispatch({ type: 'templateB', template: null });
  }, [templates.data, usable, draft.templateIdB, dispatch]);
  const slots = useMemo(() => template?.slots.map((s) => s.slot) ?? [], [template]);
  const slotsB = useMemo(() => templateB?.slots.map((s) => s.slot) ?? [], [templateB]);

  const countable = countableAudience(draft.audience);
  const settled = useSettled(countable, 500);
  // The live count and the cost of the selection follow every change (after a short pause) and show from every step.
  const count = useAudienceCount(settled.value);
  const costing = Boolean(draft.templateId) && settled.value !== null;
  const credit = useCreditCheck(costing ? draft.templateId : null, settled.value ?? draft.audience);
  const countKnown = settled.settled && !count.isFetching && !count.isPlaceholderData;
  const ctx = {
    slots,
    slotsB,
    now: new Date(),
    count: countKnown ? count.data : null,
    credit: credit.data,
    creditPending: costing && (!settled.settled || credit.isPending),
    creditFailed: costing && credit.isError,
  };
  const v1 = stepIssues(1, draft, ctx);
  const v2 = stepIssues(2, draft, ctx);
  const v3 = stepIssues(3, draft, ctx);
  const v4 = stepIssues(4, draft, ctx);
  const issuesOf = (s: WizardStep): StepIssue[] => {
    switch (s) {
      case 'setup':
        return v1.filter((i) => i.path === 'name' || i.path === 'senderKey');
      case 'compose':
        return [
          ...v1.filter((i) => i.path === 'templateId' || i.path === 'templateIdB'),
          ...v3.filter((i) => i.code === 'variable_unmapped'),
        ];
      case 'recipients':
        // Who is picked, and whether the wallet covers them: the Review step's own balance rule.
        return [
          ...v2,
          ...v3.filter((i) => BALANCE_CODES.includes(i.code) && !v2.some((x) => x.code === i.code)),
        ];
      case 'schedule':
        return v4;
      case 'review':
        return v3.filter((i) => i.code !== 'variable_unmapped');
    }
  };
  const issues = issuesOf(step);
  const visible = attempted[step] ? issues : issues.filter((i) => STATE_ISSUES.includes(i.code));
  const blocked = [...new Set(visible.map((i) => ti(i.code)))];

  const at = WIZARD_STEPS.indexOf(step);
  const reachable = (s: WizardStep) =>
    WIZARD_STEPS.slice(0, WIZARD_STEPS.indexOf(s)).every(
      (x) => issuesOf(x).filter((i) => !STATE_ISSUES.includes(i.code)).length === 0,
    );
  const go = (s: WizardStep) => {
    setNotice(null);
    setStep(s);
    dispatch({ type: 'go', step: VIEW_OF[s] });
  };
  const goTo = async (s: WizardStep) => {
    await w.flush();
    go(s);
  };

  const guard = useUnsavedGuard(w.unsaved);
  const launch = useLaunch({
    id: w.id,
    rowVersion: w.rowVersion,
    release: guard.release,
    onFailure: (f) => {
      setNotice(f);
      if (f.kind === 'wallet') {
        void credit.refetch();
        go('review');
      } else if (f.kind === 'incomplete') {
        const to = stepOfIssue(f.issues[0]?.path ?? '');
        setAttempted((a) => ({ ...a, [to]: true }));
        go(to);
      }
    },
  });

  const startLaunch = async () => {
    const check = launchPreflight(draft, ctx);
    if (check.kind === 'issues') {
      const to = stepOfIssue(check.issues[0]?.path ?? '');
      setAttempted((a) => ({ ...a, [to]: true }));
      if (to !== step) go(to);
      return;
    }
    if (!(await w.flush())) return;
    launch.show();
  };
  const next = async () => {
    if (issues.length > 0) {
      setAttempted((a) => ({ ...a, [step]: true }));
      return;
    }
    if (step === 'review') return startLaunch();
    if (!(await w.flush())) return;
    const to = WIZARD_STEPS[at + 1];
    if (to) go(to);
  };

  // Another kind of number belongs to the classic builder: ask only when something besides the name would be lost, and keep this draft.
  const dirty = draft.templateId !== null || countable !== null;
  const pickSender = (key: string) => {
    const picked = senders.find((s) => s.key === key);
    if (!picked) return;
    if (picked.guided) return act({ type: 'sender', senderKey: key });
    if (!dirty) return onClassic(key, draft.name);
    setSwitchTo(picked);
  };
  const confirmSwitch = async () => {
    if (!switchTo) return;
    if (!(await w.flush())) return setSwitchTo(null);
    guard.release();
    onClassic(switchTo.key, draft.name);
  };

  // A draft resumed when none of the workspace's numbers is a verified Meta number any more: the guided flow cannot send from any of
  // them, so the switch to the classic builder is offered at once (on the default number, else the first) instead of leaving the picker
  // on a number this flow cannot use.
  const classic = classicFallback(senders);
  const offeredSwitch = useRef(false);
  useEffect(() => {
    if (offeredSwitch.current || !classic || sender?.guided) return;
    offeredSwitch.current = true;
    setSwitchTo(classic);
  }, [classic, sender?.guided]);

  // Smart Delivery and the auto-end are read in the send's zone: the schedule's own, else the workspace's.
  const sendZone = draft.schedule.mode === 'scheduled' ? draft.schedule.timezone : zone;
  const pacingValues = Object.fromEntries(
    PACING_KEYS.map((k) => [k, String(draft.pacing[k] ?? '')]),
  ) as Record<PacingKey, string>;
  const onPacing = (key: PacingKey, value: string) => {
    const text = key === 'windowStart' || key === 'windowEnd';
    const n = Math.trunc(Number(value));
    act({
      type: 'options',
      patch: {
        pacing: {
          ...draft.pacing,
          [key]: value === '' ? null : text ? value : Number.isFinite(n) ? n : null,
        },
      },
    });
  };

  const recipients = credit.data?.recipients ?? count.data?.recipients;
  const skipped = count.data ? count.data.optedOut + count.data.invalidNumber : undefined;
  const kind = launchKind(draft.schedule);
  const form = {
    ...EMPTY_FORM,
    type: 'template' as const,
    scheduleType: draft.schedule.mode,
    abTesting: draft.abTesting,
    abSplit: draft.abSplit,
  };
  const senderLabel = sender ? `${sender.label}${sender.phone ? ` · ${sender.phone}` : ''}` : null;

  return (
    <div className="min-h-full">
      <div className="sticky top-14 z-30 bg-background">
        <BuilderHeader
          editing={false}
          backHref="/campaigns"
          busy={launch.busy}
          canDraft={w.id !== null || draft.name.trim() !== ''}
          onDraft={() =>
            void w.flush().then((ok) => {
              if (ok) toast(tw('save.saved'), 'success');
            })
          }
          actions={
            <WizardFooter
              inline
              steps={WIZARD_STEPS.length}
              step={at + 1}
              launch={kind}
              busy={launch.busy}
              blocked={blocked}
              canLaunch
              onBack={() => {
                const to = WIZARD_STEPS[at - 1];
                if (to) void goTo(to);
              }}
              onNext={() => void next()}
            />
          }
        />
        <Stepper current={step} reachable={reachable} onGo={(s) => void goTo(s)} />
      </div>
      <div className="mx-auto max-w-none px-4 py-6 sm:px-6 lg:px-7">
        {w.status === 'conflict' && (
          <Alert tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <span>{tw('conflict')}</span>
            <Button size="sm" variant="secondary" onClick={() => void w.reload()}>
              {tw('reload')}
            </Button>
          </Alert>
        )}
        {notice?.kind === 'wallet' && (
          <Alert tone="danger" className="mb-4">
            {tw('launchWallet')}
          </Alert>
        )}
        {notice?.kind === 'incomplete' && (
          <Alert tone="danger" className="mb-4">
            {tw('launchIncomplete')}
          </Alert>
        )}
        {notice?.kind === 'conflict' && (
          <Alert tone="warning" className="mb-4">
            {tw('conflict')}
          </Alert>
        )}
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_342px]">
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <form
              className="p-5"
              // Next and the launch are in the header; Enter in a field must not trigger them, nor must a button inside a card.
              onSubmit={(e) => e.preventDefault()}
            >
              <div className="mb-3 flex justify-end">
                <SaveIndicator status={w.status} onRetry={() => void w.flush()} />
              </div>
              <CardStyle.Provider value="builder">
                <div key={w.epoch}>
                  {step === 'setup' && (
                    <StepCard index="01" title={t('setup.title')} tag={t('steps.required')}>
                      <SetupFields
                        name={draft.name}
                        onName={(name) => act({ type: 'name', name })}
                        senderKey={senderKey}
                        onSender={pickSender}
                        senders={senders}
                        notVerified={false}
                        hidden={hidden}
                      />
                      <TypeCards
                        value="template"
                        offered={['template']}
                        onSelect={() => undefined}
                        blockedReason={tg('typeBlocked')}
                      />
                      <AbToggle
                        checked={draft.abTesting}
                        split={draft.abSplit}
                        onChecked={(abTesting) => act({ type: 'options', patch: { abTesting } })}
                        onSplit={(abSplit) => act({ type: 'options', patch: { abSplit } })}
                      />
                      {visible.map((i) => (
                        <p key={i.path} role="alert" className="text-[12px] text-danger">
                          {ti(i.code)}
                        </p>
                      ))}
                    </StepCard>
                  )}
                  {step === 'compose' && (
                    <StepCard index="02" title={t('compose.title')} tag={t('steps.required')}>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <Field
                            label={`${draft.abTesting ? tg('templateA') : tg('template')} *`}
                            htmlFor="camp-template"
                            hint={
                              usable.length === 0 && templates.data ? undefined : tg('templateHint')
                            }
                            error={
                              usable.length === 0 && templates.data
                                ? tg('noTemplates')
                                : visible.some((i) => i.path === 'templateId')
                                  ? ti('template_required')
                                  : undefined
                            }
                          >
                            <Select
                              id="camp-template"
                              value={template?.id ?? ''}
                              disabled={!templates.data || usable.length === 0}
                              onChange={(e) =>
                                act({
                                  type: 'template',
                                  template: usable.find((x) => x.id === e.target.value) ?? null,
                                })
                              }
                            >
                              <option value="">{tg('pickTemplate')}</option>
                              {usable.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name} · {x.language}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                      </div>
                      <VariablesCard
                        template={template}
                        variables={draft.variables}
                        audience={draft.audience}
                        properties={properties}
                        issues={issuesOf('compose').filter((i) => i.path.startsWith('variables.'))}
                        showIssues={Boolean(attempted.compose)}
                        {...(draft.abTesting ? { title: tg('variablesA') } : {})}
                        onVariable={(slot, source) => act({ type: 'variable', slot, source })}
                        onVariables={(variables) => act({ type: 'variables', variables })}
                      />
                      {draft.abTesting && (
                        <>
                          <p className="text-[12px] text-muted-foreground">
                            {tg('splitNote', { a: draft.abSplit })}
                          </p>
                          <Field
                            label={`${tg('templateB')} *`}
                            htmlFor="camp-template-b"
                            error={
                              visible.some((i) => i.path === 'templateIdB')
                                ? ti('template_b_required')
                                : undefined
                            }
                          >
                            <Select
                              id="camp-template-b"
                              value={templateB?.id ?? ''}
                              disabled={!templates.data || usable.length === 0}
                              onChange={(e) =>
                                act({
                                  type: 'templateB',
                                  template: usable.find((x) => x.id === e.target.value) ?? null,
                                })
                              }
                            >
                              <option value="">{tg('pickTemplate')}</option>
                              {usable.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name} · {x.language}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <VariablesCard
                            id="review-variables-b"
                            title={tg('variablesB')}
                            template={templateB}
                            variables={draft.variablesB}
                            audience={draft.audience}
                            properties={properties}
                            issues={issuesOf('compose')
                              .filter((i) => i.path.startsWith('variablesB.'))
                              .map((i) => ({
                                ...i,
                                path: i.path.replace('variablesB.', 'variables.'),
                              }))}
                            showIssues={Boolean(attempted.compose)}
                            onVariable={(slot, source) => act({ type: 'variableB', slot, source })}
                            onVariables={(variables) => act({ type: 'variablesB', variables })}
                          />
                        </>
                      )}
                    </StepCard>
                  )}
                  {step === 'recipients' && (
                    <StepCard index="03" title={t('audience.title')} tag={t('audience.tag')}>
                      <div className="flex h-[44rem] max-h-[85dvh] min-h-[30rem] flex-col">
                        <AudienceBody
                          audience={draft.audience}
                          sources={sources}
                          issues={visible}
                          onAudience={(patch) => act({ type: 'audience', patch })}
                        />
                      </div>
                    </StepCard>
                  )}
                  {step === 'schedule' && (
                    <StepCard index="04" title={tg('deliveryTitle')} tag={tg('deliveryTag')}>
                      <TestSendCard
                        draftId={w.id}
                        canTest={canTest}
                        ensureSaved={w.flush}
                        currency={credit.data?.currency ?? null}
                      />
                      <ScheduleCard
                        schedule={draft.schedule}
                        zone={zone}
                        issues={visible}
                        onSchedule={(schedule) => {
                          act({ type: 'schedule', schedule });
                          // The auto-end is read in the send's zone: it follows a change of the schedule's zone.
                          if (
                            draft.autoEnd &&
                            schedule.mode === 'scheduled' &&
                            schedule.timezone !== draft.autoEnd.timezone
                          )
                            act({
                              type: 'options',
                              patch: { autoEnd: { ...draft.autoEnd, timezone: schedule.timezone } },
                            });
                        }}
                      />
                      <AutoEndField
                        value={draft.autoEnd?.at ?? ''}
                        onChange={(at) =>
                          act({
                            type: 'options',
                            patch: { autoEnd: at ? { at, timezone: sendZone } : null },
                          })
                        }
                        error={
                          visible.find((i) => i.path === 'autoEnd')
                            ? ti(visible.find((i) => i.path === 'autoEnd')!.code)
                            : undefined
                        }
                      />
                      <RetriesCard
                        retries={draft.retries}
                        issues={visible}
                        onRetries={(retries) => act({ type: 'retries', retries })}
                      />
                      <SmartDelivery
                        zone={sendZone}
                        values={pacingValues}
                        onChange={onPacing}
                        error={
                          visible.some((i) => i.path.startsWith('pacing'))
                            ? ti('pacing_range')
                            : undefined
                        }
                      />
                      <TrackClicks
                        checked={draft.trackLinks}
                        onChange={(trackLinks) => act({ type: 'options', patch: { trackLinks } })}
                      />
                    </StepCard>
                  )}
                  {step === 'review' && (
                    <StepCard index="05" title={t('review.title')} tag={t('review.tag')}>
                      <CreditCard credit={credit} />
                      <TestSendCard
                        draftId={w.id}
                        canTest={canTest}
                        ensureSaved={w.flush}
                        currency={credit.data?.currency ?? null}
                      />
                      <SummaryCard
                        draft={draft}
                        template={template}
                        sender={sender}
                        sources={sources.data}
                        count={count.data}
                        credit={credit.data}
                        onEdit={(view) => void goTo(STEP_OF_VIEW[view])}
                      />
                    </StepCard>
                  )}
                </div>
              </CardStyle.Provider>
            </form>
          </div>

          <LivePreview
            form={form}
            builder={undefined}
            engine="waba"
            senderLabel={senderLabel}
            recipients={recipients ?? 0}
            step={at + 1}
            stepCount={WIZARD_STEPS.length}
            model={template ? previewModelOf(template) : null}
            modelB={templateB ? previewModelOf(templateB) : null}
            pinned
          >
            <CountPanel
              count={count}
              hasSource={countable !== null}
              updating={!settled.settled}
              compact
            />
            <CostPanel
              credit={credit}
              hasTemplate={Boolean(draft.templateId)}
              hasAudience={countable !== null}
            />
          </LivePreview>
        </div>
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
        onConfirm={() => void launch.confirm(tw('launchFailed'))}
        onClose={launch.close}
      />
      <ConfirmDialog
        open={switchTo !== null}
        title={tw('switch.title')}
        message={tw('switch.body', {
          number: switchTo?.label ?? '',
          engine: switchTo?.engineLabel ?? '',
        })}
        confirmLabel={tw('switch.confirm')}
        cancelLabel={tw('switch.cancel')}
        onClose={() => setSwitchTo(null)}
        onConfirm={() => void confirmSwitch()}
      />
      <ConfirmDialog
        open={guard.pending !== null}
        tone="danger"
        title={tw('leaveTitle')}
        message={tw('leaveBody')}
        confirmLabel={tw('leave')}
        cancelLabel={tw('stay')}
        onClose={guard.stay}
        onConfirm={guard.leave}
      />
    </div>
  );
}
