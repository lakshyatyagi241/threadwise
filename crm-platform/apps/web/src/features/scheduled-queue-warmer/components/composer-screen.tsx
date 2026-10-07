'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ScheduleOptions } from '@crm/contracts';
import { Alert, Button, Spinner, useToast, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useAudiencePreview, useCreateSchedule, useScheduleOptions } from '../api/schedules';
import {
  audienceCount,
  audienceInput,
  firstInvalidStep,
  initialDraft,
  LAST_STEP,
  stepOfServerErrors,
  toCreateInput,
  validateStep,
  type Draft,
  type Step,
} from '../lib/composer-model';
import { browserTimezone } from '../lib/time';
import { AudienceStep, BasicsStep, MessageStep, ReviewStep, WhenStep } from './composer-steps';
import { ErrorNotice } from './error-notice';
import { Icon } from './icons';
import { useErrorText, type ErrorText } from './use-error-text';
import { offerSenders, submittableSenderKeys } from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';

const STEP_KEYS = ['basics', 'audience', 'message', 'when', 'review'] as const;

/**
 * `/scheduled/create` (WD-SCHED-003 to 007): the five-step composer. Each step is checked before "Next"; the server's own
 * field errors take the person back to the step that holds the field. A live preview shows the message as it will read.
 */
export function ComposerScreen() {
  const t = useTranslations('scheduled-queue-warmer.composer');
  const canManage = useCan('sched.schedules.manage');
  const errorText = useErrorText();
  const options = useScheduleOptions();
  // Personal numbers (the unofficial engine) are offered only while the platform has switched it on.
  const unofficial = useUnofficialWhatsapp();

  if (!canManage) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Alert tone="danger">{t('forbidden')}</Alert>
      </div>
    );
  }
  if (options.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner />
      </div>
    );
  }
  if (options.isError || !options.data) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorNotice error={errorText(options.error)} />
      </div>
    );
  }
  return (
    <Composer opts={{ ...options.data, senders: offerSenders(options.data.senders, unofficial) }} />
  );
}

function Composer({ opts }: { opts: ScheduleOptions }) {
  const t = useTranslations('scheduled-queue-warmer.composer');
  const router = useRouter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const create = useCreateSchedule();
  const unofficial = useUnofficialWhatsapp();

  // The draft starts here, in the browser, where the wall clock and zone are known.
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(
      Date.now(),
      browserTimezone(),
      opts.senders.map((s) => s.key),
    ),
  );
  const [step, setStep] = useState<Step>(1);
  const [tried, setTried] = useState<ReadonlySet<Step>>(new Set());
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [key, setKey] = useState(() => crypto.randomUUID());

  const set = (patch: Partial<Draft>) => {
    setFailure(null);
    setNow(Date.now());
    setDraft((d) => ({ ...d, ...patch }));
  };
  const ctx = { options: opts, now };

  const preview = useAudiencePreview(audienceInput(draft), step >= 2 && audienceCount(draft) > 0);

  const errors = tried.has(step) ? validateStep(draft, step, ctx) : {};
  const server = failure?.fieldErrors ?? [];
  const props = { draft, set, errors, server, options: opts };

  const next = () => {
    setNow(Date.now());
    setTried((s) => new Set(s).add(step));
    if (Object.keys(validateStep(draft, step, ctx)).length === 0 && step < LAST_STEP) {
      setStep((step + 1) as Step);
    }
  };

  const submit = () => {
    setNow(Date.now());
    // A number ticked while the engine was on must not be submitted once it is off.
    const sendable: Draft = { ...draft, senders: submittableSenderKeys(draft.senders, unofficial) };
    const bad = firstInvalidStep(sendable, ctx);
    if (bad) {
      setTried((s) => new Set(s).add(bad));
      setStep(bad);
      return;
    }
    setFailure(null);
    create.mutate(
      { input: toCreateInput(sendable), key },
      {
        onSuccess: (r) => {
          toast(r.message, 'success');
          if (r.testSent === false && r.testError) toast(r.testError, 'danger');
          router.push(r.ids.length === 1 ? `/scheduled/${r.ids[0]}` : '/scheduled');
        },
        onError: (e) => {
          // A retry after a refusal is a new attempt, not a replay of the refused one.
          setKey(crypto.randomUUID());
          const x = errorText(e);
          setFailure(x);
          const at = stepOfServerErrors(x.fieldErrors);
          if (at) setStep(at);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <Link
          href="/scheduled"
          aria-label={t('back')}
          className="inline-flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted"
        >
          <Icon name="back" className="size-4" />
        </Link>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('crumb')}
          </div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="rounded-md border border-border bg-background">
          <ol className="flex flex-wrap gap-1 border-b border-border p-3" aria-label={t('steps')}>
            {STEP_KEYS.map((k, i) => {
              const n = (i + 1) as Step;
              return (
                <li key={k} className="flex-1">
                  <button
                    type="button"
                    aria-current={n === step ? 'step' : undefined}
                    disabled={n > step}
                    onClick={() => setStep(n)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold disabled:cursor-default',
                      n === step
                        ? 'bg-brand text-brand-foreground'
                        : n < step
                          ? 'text-brand'
                          : 'text-muted-foreground',
                    )}
                  >
                    <span className="grid size-5 place-items-center rounded-full border border-current text-[10px]">
                      {n < step ? <Icon name="check" className="size-3" /> : n}
                    </span>
                    {t(`stepNames.${k}`)}
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="p-5">
            {step === 1 && <BasicsStep {...props} />}
            {step === 2 && (
              <AudienceStep
                {...props}
                preview={preview.data}
                previewing={preview.isFetching && !preview.data}
              />
            )}
            {step === 3 && <MessageStep {...props} total={preview.data?.total ?? 0} />}
            {step === 4 && <WhenStep {...props} />}
            {step === 5 && <ReviewStep {...props} preview={preview.data} />}
            {failure && (
              <div className="mt-4">
                <ErrorNotice error={failure} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border p-3">
            <Button
              variant="secondary"
              disabled={step === 1 || create.isPending}
              onClick={() => setStep((step - 1) as Step)}
            >
              {t('previous')}
            </Button>
            <div className="text-xs text-muted-foreground">
              {t('stepOf', { n: step, total: LAST_STEP })}
            </div>
            {step < LAST_STEP ? (
              <Button variant="brand" onClick={next}>
                {t('next')}
                <Icon name="next" />
              </Button>
            ) : (
              <Button variant="brand" onClick={submit} disabled={create.isPending} id="btn-submit">
                {create.isPending ? <Spinner /> : null}
                {t('submit')}
              </Button>
            )}
          </div>
        </div>

        <aside
          className="h-fit rounded-md border border-border bg-background p-4"
          aria-label={t('preview.title')}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('preview.title')}
            </span>
            <span className="text-[10px] text-muted-foreground">{t('preview.channel')}</span>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-lg rounded-ss-none bg-background p-2.5 text-[13px] shadow-sm">
              {draft.messageType === 'template' ? (
                <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">
                  {opts.templates.find((x) => x.id === draft.templateId)?.name ??
                    t('preview.noTemplate')}
                </div>
              ) : null}
              {draft.messageType === 'location'
                ? draft.latitude && draft.longitude
                  ? `${draft.latitude}, ${draft.longitude}`
                  : t('preview.pin')
                : draft.messageType === 'template'
                  ? null
                  : draft.message ||
                    (draft.messageType === 'media' ? t('preview.media') : t('preview.empty'))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
