'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { PLAN_UPGRADE_PATH, type LeadSourceResponse } from '@crm/contracts';
import { Alert, Button, Spinner, useToast } from '@crm/ui';
import { createSource, leadKeys, updateSource } from '../api';
import {
  FORM_STEPS,
  WIZARD_STEPS,
  allProblems,
  buildCreateBody,
  buildMappingUpdate,
  emptyDraft,
  firstStepWithProblem,
  isDirty,
  problemsOfSteps,
  stepOfField,
  type Problems,
  type SourceDraft,
  type WizardStep,
} from '../lib/draft';
import { issuesByPath, leadError, type LeadError } from '../lib/errors';
import type { HookUrlEnv } from '../lib/hook-url';
import { LEADS_MANAGE, useLeadsCan } from '../lib/permissions';
import { dismissReveal, needsLeaveGuard, revealOf, type Reveal } from '../lib/reveal';
import { ROUTES, sourceHref } from '../lib/source-view';
import { MappingStudio, usePathFocus } from './mapping-studio';
import { RevealPanel } from './reveal-panel';
import { BasicsFields, DefaultsFields, type SetDraft } from './source-fields';
import { FirstLeadWatch, TestLeadPanel } from './test-lead-panel';
import { ErrorText, NoAccess } from './ui';

const LINK =
  'inline-flex h-10 items-center rounded-md px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

/**
 * `/lead-sources/new`: the create wizard for a webhook source.
 *
 * Design: the mapping preview needs a saved source (`POST /lead-sources/:id/mapping-preview`), and the URL token exists only once the
 * source does. So the wizard collects the basics and the defaults (everything the create call accepts), creates the source, shows
 * the one-time URL and token (step 3, with a test lead and a "waiting for the first lead" check), and only then maps the fields
 * with the live preview against the saved source (step 4, saved with a PATCH that carries the rowVersion).
 *
 * The token is held ONLY in this component's state: the create call goes through `useMutation` but the mutation returns the
 * source alone, so the token is never in the query cache; it is not written to storage, the address or the console, and the page
 * asks before it unloads while it is still on screen.
 */
export function NewSourcePage({ hookEnv }: { hookEnv: HookUrlEnv }) {
  const can = useLeadsCan();
  if (!can.manage) return <NoAccess permission={LEADS_MANAGE} />;
  return <Wizard hookEnv={hookEnv} />;
}

function Wizard({ hookEnv }: { hookEnv: HookUrlEnv }) {
  const t = useTranslations('lead-sources.wizard');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = useLeadsCan();

  const [step, setStep] = useState<WizardStep>('basics');
  const [draft, setDraft] = useState<SourceDraft>(emptyDraft);
  const [snapshot, setSnapshot] = useState<SourceDraft | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [created, setCreated] = useState<LeadSourceResponse | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [failure, setFailure] = useState<LeadError | null>(null);

  const set: SetDraft = (fn) => setDraft(fn);
  const focus = usePathFocus(draft, set);

  // The token is on screen and nowhere else: leaving now would lose it for good, so the browser asks first.
  useEffect(() => {
    if (!needsLeaveGuard(reveal)) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [reveal]);

  const create = useMutation({
    mutationFn: async () => {
      const { source, secrets } = await createSource(buildCreateBody(draft));
      // The token goes to component state and nowhere else; the mutation's own result is the source alone.
      setReveal(revealOf(secrets, 'created'));
      return source;
    },
    onSuccess: (source) => {
      qc.setQueryData(leadKeys.one(source.id), source);
      void qc.invalidateQueries({ queryKey: leadKeys.list });
      setCreated(source);
      setSnapshot(draft);
      setFailure(null);
      setStep('connect');
      toast(t('created', { name: source.name }));
    },
    onError: (error) => {
      const e = leadError(error);
      setFailure(e);
      // A problem with a field goes back to the step that owns it.
      const first = e.issues[0];
      if (first) {
        const owner = stepOfField(first.path);
        if ((FORM_STEPS as readonly WizardStep[]).includes(owner)) setStep(owner);
      }
    },
  });

  const saveMapping = useMutation({
    mutationFn: () => updateSource(created!.id, buildMappingUpdate(draft, created!.rowVersion)),
    onSuccess: (source) => {
      qc.setQueryData(leadKeys.one(source.id), source);
      void qc.invalidateQueries({ queryKey: leadKeys.list });
      toast(t('mappingSaved'));
      router.push(sourceHref(source.id));
    },
    onError: (error) => setFailure(leadError(error)),
  });

  const problems: Problems = showProblems ? allProblems(draft, 'create') : {};
  const server = issuesByPath(failure);
  const stepIndex = WIZARD_STEPS.indexOf(step);
  const beforeCreate = created === null;

  const next = () => {
    const own = problemsOfSteps(allProblems(draft, 'create'), [step]);
    if (Object.keys(own).length > 0) {
      setShowProblems(true);
      return;
    }
    setShowProblems(false);
    setFailure(null);
    setStep(WIZARD_STEPS[Math.min(stepIndex + 1, WIZARD_STEPS.length - 1)]!);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step === 'basics') return next();
    if (step === 'rules') {
      const all = allProblems(draft, 'create');
      const bad = firstStepWithProblem(all);
      if (bad && (FORM_STEPS as readonly WizardStep[]).includes(bad)) {
        setShowProblems(true);
        setStep(bad);
        return;
      }
      setFailure(null);
      create.mutate();
    }
  };

  const planFailure = failure && (failure.kind === 'planLimit' || failure.kind === 'locked');

  return (
    <div className={`mx-auto space-y-6 ${step === 'mapping' ? 'max-w-6xl' : 'max-w-3xl'}`}>
      <header className="space-y-1">
        <Link
          href={ROUTES.webhooks}
          className="inline-flex text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <ol className="flex flex-wrap gap-2" aria-label={t('stepsLabel')}>
        {WIZARD_STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              s === step
                ? 'border-primary bg-primary/10 text-primary'
                : i < stepIndex
                  ? 'border-border text-foreground'
                  : 'border-border text-muted-foreground'
            }`}
          >
            <span className="tabular-nums">{i + 1}</span>
            {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      {planFailure && failure && (
        <Alert tone="warning" className="space-y-2" data-testid="plan-problem">
          <p>{t(failure.kind === 'planLimit' ? 'planLimit' : 'planLocked')}</p>
          <Link
            href={failure.upgradeUrl ?? PLAN_UPGRADE_PATH}
            className="font-medium underline underline-offset-2"
          >
            {t('upgrade')}
          </Link>
        </Alert>
      )}
      {failure && !planFailure && (failure.kind !== 'field' || failure.issues.length === 0) && (
        <ErrorText mapped={failure} />
      )}

      {beforeCreate ? (
        <form onSubmit={submit} noValidate aria-label={t(`steps.${step}`)} className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t(`stepTitle.${step}`)}</h2>
            <p className="text-sm text-muted-foreground">{t(`stepHelp.${step}`)}</p>
          </div>
          {step === 'basics' && (
            <BasicsFields draft={draft} set={set} problems={problems} server={server} />
          )}
          {step === 'rules' && (
            <DefaultsFields draft={draft} set={set} problems={problems} server={server} />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={stepIndex === 0 || create.isPending}
              onClick={() => setStep(WIZARD_STEPS[Math.max(stepIndex - 1, 0)]!)}
            >
              {t('previous')}
            </Button>
            <div className="flex items-center gap-2">
              <Link href={ROUTES.webhooks} className={LINK}>
                {t('cancel')}
              </Link>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Spinner />}
                {step === 'rules' ? t('create') : t('next')}
              </Button>
            </div>
          </div>
        </form>
      ) : step === 'connect' ? (
        <ConnectStep
          source={created}
          reveal={reveal}
          hookEnv={hookEnv}
          canManage={can.manage}
          onReveal={setReveal}
          onDone={() => {
            setReveal(dismissReveal(reveal));
            setStep('mapping');
          }}
          onContinue={() => setStep('mapping')}
        />
      ) : (
        <section aria-label={t('steps.mapping')} className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('stepTitle.mapping')}</h2>
            <p className="text-sm text-muted-foreground">{t('stepHelp.mapping')}</p>
          </div>
          <MappingStudio
            sourceId={created.id}
            draft={draft}
            set={set}
            problems={problems}
            server={server}
            canPreview={can.manage}
            focus={focus}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Link href={sourceHref(created.id)} className={LINK}>
              {t('skipMapping')}
            </Link>
            <Button
              type="button"
              disabled={saveMapping.isPending}
              onClick={() => {
                const own = problemsOfSteps(allProblems(draft, 'update'), ['basics', 'mapping']);
                if (Object.keys(own).length > 0) {
                  setShowProblems(true);
                  return;
                }
                if (snapshot && !isDirty(draft, snapshot)) {
                  router.push(sourceHref(created.id));
                  return;
                }
                setFailure(null);
                saveMapping.mutate();
              }}
            >
              {saveMapping.isPending && <Spinner />}
              {t('finish')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

export function ConnectStep({
  source,
  reveal,
  hookEnv,
  canManage,
  onReveal,
  onDone,
  onContinue,
}: {
  source: LeadSourceResponse;
  reveal: Reveal | null;
  hookEnv: HookUrlEnv;
  canManage: boolean;
  onReveal: (next: Reveal | null) => void;
  onDone: () => void;
  onContinue: () => void;
}) {
  const t = useTranslations('lead-sources.wizard');
  return (
    <section aria-label={t('steps.connect')} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('stepTitle.connect')}</h2>
        <p className="text-sm text-muted-foreground">{t('stepHelp.connect')}</p>
      </div>
      {reveal ? (
        <RevealPanel
          reveal={reveal}
          env={hookEnv}
          hasSecret={source.hasSecret}
          onChange={onReveal}
          onDone={onDone}
          extra={
            <div className="space-y-3">
              <TestLeadPanel source={source} canManage={canManage} />
              <FirstLeadWatch sourceId={source.id} />
            </div>
          }
        />
      ) : (
        <>
          <Alert tone="info">{t('revealGone')}</Alert>
          <Button type="button" onClick={onContinue}>
            {t('toMapping')}
          </Button>
        </>
      )}
    </section>
  );
}
