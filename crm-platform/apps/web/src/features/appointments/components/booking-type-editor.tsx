'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Alert, Button, ConfirmDialog, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import {
  KEYS,
  invalidateBookingTypes,
  useAppointmentsSetup,
  useBookingType,
  useDisplayZone,
} from '../api/hooks';
import type { BookingType } from '../api/schemas';
import { appointmentsApi } from '../api/service';
import {
  LIMITS,
  STEPS,
  draftToInput,
  firstProblemStep,
  newDraft,
  slugify,
  stepOfProblem,
  typeToDraft,
  validateDraft,
  type BookingTypeDraft,
  type Step,
} from '../lib/booking-form';
import { draftSignature, firstBlocker, firstStepOfKeys, serverProblems } from '../lib/editor';
import { errorKind, fieldErrors } from '../lib/errors';
import { AvailabilityStep } from './editor-availability';
import { MessagingStep } from './editor-messaging';
import { PricingStep } from './editor-pricing';
import { EditorRail } from './editor-rail';
import { EditorProvider, type EditorContextValue } from './editor-shared';
import { ServiceStep } from './editor-service';
import { EditorStepper } from './editor-stepper';
import { TimingStep } from './editor-timing';
import { ArrowLeftIcon, ChevronRightIcon, flip } from './icons';
import { ErrorLine, useAppointmentsCan, useErrorText } from './parts';

const LIST_HREF = '/appointments/types';

/** The origin never changes while the page is open, so there is nothing to subscribe to. */
const noopSubscribe = () => () => undefined;
const readOrigin = () => window.location.origin;
const serverOrigin = () => '';

/**
 * `/appointments/types/new` and `/appointments/types/<id>`: Reference's five-step booking type wizard (Service, Timing,
 * Availability, Pricing, Messaging) with its persistent live summary. The form is one draft of strings, validated by
 * `lib/booking-form`; the server's own checks come back as field errors on the same boxes.
 */
export function BookingTypeEditor({ id }: { id?: string }) {
  useAppointmentsSetup();
  const t = useTranslations('appointments.editor');
  const can = useAppointmentsCan();
  const query = useBookingType(id ?? null);

  if (!can.manageTypes) {
    return (
      <div className="space-y-3">
        <BackLink />
        <Alert tone="warning">{t('forbidden')}</Alert>
      </div>
    );
  }
  if (id === undefined) return <EditorForm key="new" type={null} />;
  if (query.isError) {
    return (
      <div className="space-y-3">
        <BackLink />
        {errorKind(query.error) === 'notFound' ? (
          <EmptyState
            title={t('notFoundTitle')}
            message={t('notFound')}
            actions={
              <Link
                href={LIST_HREF}
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
              >
                {t('header.back')}
              </Link>
            }
          />
        ) : (
          <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }
  // A copy left in the cache from the list is not enough: the form starts from what the server has now, with its row version.
  if (query.isPending || !query.isFetchedAfterMount) return <LoadingState />;
  return <EditorForm key={query.data.id} type={query.data} />;
}

function BackLink() {
  const t = useTranslations('appointments.editor.header');
  return (
    <Link
      href={LIST_HREF}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className={cn('size-3.5', flip)} /> {t('back')}
    </Link>
  );
}

function LoadingState() {
  const t = useTranslations('appointments.editor');
  return (
    <div className="space-y-4" role="status" aria-label={t('loading')}>
      <div className="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="h-[28rem] animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}

function EditorForm({ type }: { type: BookingType | null }) {
  const t = useTranslations('appointments.editor');
  const ta = useTranslations('appointments.appearance.editorLink');
  const te = useTranslations('appointments.editor.problems');
  const errorText = useErrorText();
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const { toast } = useToast();
  const zone = useDisplayZone();
  const base = useId();
  const origin = useSyncExternalStore(noopSubscribe, readOrigin, serverOrigin);

  // The type as it was when the form opened: its row version is what a save is checked against, even if the list refetches.
  const [loaded] = useState(type);
  const [draft, setDraft] = useState<BookingTypeDraft>(() => {
    if (type) {
      const d = typeToDraft(type);
      return d.timezone ? d : { ...d, timezone: zone };
    }
    return newDraft({ timezone: zone, currency: (session.org.currency ?? 'USD').toUpperCase() });
  });
  const [baseline] = useState(() => draftSignature(draft));
  const [step, setStep] = useState<Step>('service');
  const [autoSlug, setAutoSlug] = useState(type === null);
  const [seen, setSeen] = useState<ReadonlySet<Step>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ kind: 'conflict' | 'other'; error: unknown } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leaving = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const dirty = draftSignature(draft) !== baseline;
  const problems = useMemo(() => validateDraft(draft), [draft]);
  const at = STEPS.indexOf(step);
  const last = at === STEPS.length - 1;
  const fid = useCallback((key: string) => `${base}-${key}`, [base]);

  // ---- changing the form ------------------------------------------------------------------------------------------------

  const clearServer = () => setServerErr((cur) => (Object.keys(cur).length > 0 ? {} : cur));
  const set = useCallback(
    <K extends keyof BookingTypeDraft>(key: K, value: BookingTypeDraft[K]) => {
      setDraft((d) => ({ ...d, [key]: value }));
      setServerErr((cur) => (Object.keys(cur).length > 0 ? {} : cur));
    },
    [],
  );
  const update = useCallback((fn: (d: BookingTypeDraft) => BookingTypeDraft) => {
    setDraft(fn);
    setServerErr((cur) => (Object.keys(cur).length > 0 ? {} : cur));
  }, []);

  const onName = (name: string) => {
    clearServer();
    setDraft((d) => ({ ...d, name, slug: autoSlug ? slugify(name) : d.slug }));
  };
  const onSlug = (value: string) => {
    const slug = value.toLowerCase().replace(/\s+/g, '-');
    clearServer();
    if (slug === '') {
      // an empty link follows the name again
      setAutoSlug(true);
      setDraft((d) => ({ ...d, slug: slugify(d.name) }));
    } else {
      setAutoSlug(false);
      setDraft((d) => ({ ...d, slug }));
    }
  };

  // ---- problems the person is shown --------------------------------------------------------------------------------------

  const shown = (key: string) => attempted || seen.has(stepOfProblem(key));
  const err = useCallback(
    (key: string): string | undefined => {
      if (key in serverErr) return te('server');
      const code = problems[key];
      return code && shown(key) ? te(code, LIMITS) : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [problems, serverErr, attempted, seen, te],
  );
  const flagged = useMemo(() => {
    const out = new Set<Step>();
    for (const key of Object.keys(problems))
      if (attempted || seen.has(stepOfProblem(key))) out.add(stepOfProblem(key));
    for (const key of Object.keys(serverErr)) out.add(stepOfProblem(key));
    return out;
  }, [problems, serverErr, attempted, seen]);

  // ---- moving between steps ---------------------------------------------------------------------------------------------

  const focusSoon = (target: string | null) => {
    window.requestAnimationFrame(() => {
      const card = cardRef.current;
      if (card && card.getBoundingClientRect().top < 56) card.scrollIntoView({ block: 'start' });
      (target ? document.getElementById(target) : headingRef.current)?.focus({
        preventScroll: target === null,
      });
    });
  };

  function go(target: Step) {
    if (target === step) return;
    setSeen((cur) => new Set(cur).add(step));
    // Reference stops a move forward on a missing name (step 1) or a missing duration (step 2)
    const blocked = firstBlocker(step, target, problems);
    if (blocked) {
      setSeen((cur) => new Set(cur).add(blocked.step));
      setStep(blocked.step);
      focusSoon(fid(blocked.key));
      return;
    }
    setStep(target);
    focusSoon(null);
  }

  // ---- saving ---------------------------------------------------------------------------------------------------------------

  async function save() {
    if (busy) return;
    setFormError(null);
    const first = firstProblemStep(problems);
    if (first) {
      setAttempted(true);
      setStep(first);
      const key = Object.keys(problems).find((k) => stepOfProblem(k) === first);
      focusSoon(key ? fid(key.replace(':', '-')) : null);
      return;
    }
    setBusy(true);
    try {
      const input = draftToInput(draft);
      const saved = loaded
        ? await appointmentsApi.updateType({ id: loaded.id, rowVersion: loaded.rowVersion }, input)
        : await appointmentsApi.createType(input);
      leaving.current = true;
      qc.setQueryData(KEYS.type(saved.id), saved);
      await invalidateBookingTypes(qc);
      toast(t(loaded ? 'toast.updated' : 'toast.created', { name: saved.name }), 'success');
      router.push(LIST_HREF);
    } catch (e) {
      leaving.current = false;
      const kind = errorKind(e);
      const fields = serverProblems(fieldErrors(e));
      if (kind === 'conflict') {
        setFormError({ kind: 'conflict', error: e });
      } else if (Object.keys(fields).length > 0) {
        setServerErr(fields);
        const hit = firstStepOfKeys(Object.keys(fields));
        setStep(hit?.step ?? 'service');
        focusSoon(hit ? fid(hit.key) : null);
      } else {
        setFormError({ kind: 'other', error: e });
      }
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (last) void save();
    else go(STEPS[at + 1]!);
  }

  // Enter inside a box never moves on or saves: a person typing a label must not create the booking type by accident.
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    const el = e.target;
    if (
      e.key === 'Enter' &&
      el instanceof HTMLInputElement &&
      el.type !== 'button' &&
      el.type !== 'submit'
    )
      e.preventDefault();
  }

  // ---- leaving ---------------------------------------------------------------------------------------------------------------

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  useEffect(() => {
    if (formError) alertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [formError]);

  const requestLeave = () => {
    if (dirty && !busy) setConfirmLeave(true);
    else router.push(LIST_HREF);
  };

  const ctx: EditorContextValue = {
    draft,
    set,
    update,
    err,
    fid,
    disabled: busy,
    typeId: loaded?.id ?? null,
  };
  const editing = loaded !== null;
  const publicUrl = loaded?.isActive && loaded.publicUrl ? loaded.publicUrl : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={LIST_HREF}
            onClick={(e) => {
              if (dirty && !busy) {
                e.preventDefault();
                setConfirmLeave(true);
              }
            }}
            aria-label={t('header.back')}
            title={t('header.back')}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeftIcon className={flip} />
          </Link>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {t(editing ? 'header.kickerEdit' : 'header.kickerNew')}
            </div>
            <h1 className="truncate text-xl font-bold tracking-tight" dir="auto">
              {t(editing ? 'header.titleEdit' : 'header.titleNew')}
            </h1>
          </div>
        </div>
        {!editing ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium">
            {t('header.draft')}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <span className="inline-flex items-center rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                {t('header.unsaved')}
              </span>
            )}
            {/* The booking page's own look (logo, colours, welcome text) is a screen of its own, with a live preview. */}
            <Link
              href={`/appointments/types/${loaded.id}/appearance`}
              onClick={(e) => {
                if (dirty && !busy) {
                  e.preventDefault();
                  toast(ta('saveFirst'), 'danger');
                }
              }}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              {ta('link')}
            </Link>
          </div>
        )}
      </header>

      <form
        noValidate
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        aria-label={t(editing ? 'header.titleEdit' : 'header.titleNew')}
        className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21.5rem]"
      >
        <div
          ref={cardRef}
          className="min-w-0 scroll-mt-16 overflow-hidden rounded-xl border border-border bg-background"
        >
          <EditorStepper current={step} withProblems={flagged} onGo={go} />

          <div className="bg-muted/20 p-4 sm:p-5">
            <h2 ref={headingRef} tabIndex={-1} className="sr-only">
              {t('steps.stepOf', { n: at + 1, total: STEPS.length, name: t(`steps.${step}`) })}
            </h2>
            {formError && (
              <div ref={alertRef} className="mb-4">
                {formError.kind === 'conflict' ? (
                  <Alert tone="danger">
                    <p>{t('saveError.conflict')}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        leaving.current = true;
                        window.location.reload();
                      }}
                    >
                      {t('saveError.reload')}
                    </Button>
                  </Alert>
                ) : (
                  <Alert tone="danger">{errorText(formError.error)}</Alert>
                )}
              </div>
            )}
            <EditorProvider value={ctx}>
              {step === 'service' && (
                <ServiceStep
                  onName={onName}
                  onSlug={onSlug}
                  origin={origin}
                  orgSlug={session.org.slug}
                />
              )}
              {step === 'timing' && <TimingStep />}
              {step === 'availability' && <AvailabilityStep />}
              {step === 'pricing' && <PricingStep />}
              {step === 'messaging' && <MessagingStep />}
            </EditorProvider>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3 sm:px-5">
            <Button
              variant="secondary"
              disabled={at === 0 || busy}
              onClick={() => go(STEPS[at - 1]!)}
            >
              <ArrowLeftIcon className={flip} /> {t('nav.back')}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={requestLeave} disabled={busy}>
                {t('nav.cancel')}
              </Button>
              {last ? (
                <Button type="submit" variant="brand" disabled={busy}>
                  {busy && <Spinner label={t('nav.saving')} />}
                  {editing ? t('nav.save') : t('nav.create')}
                </Button>
              ) : (
                <Button type="submit" variant="brand" disabled={busy}>
                  {t('nav.next')} <ChevronRightIcon className={flip} />
                </Button>
              )}
            </div>
          </div>
        </div>

        <EditorRail draft={draft} step={step} publicUrl={publicUrl} />
      </form>

      <ConfirmDialog
        open={confirmLeave}
        title={t('leave.title')}
        message={t('leave.message')}
        confirmLabel={t('leave.discard')}
        cancelLabel={t('leave.keep')}
        tone="danger"
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => {
          leaving.current = true;
          setConfirmLeave(false);
          router.push(LIST_HREF);
        }}
      />
    </div>
  );
}
