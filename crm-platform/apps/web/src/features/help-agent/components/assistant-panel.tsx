'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HELP_AGENT_MAX_TASK_CHARS } from '@crm/contracts';
import { Alert, Button, Spinner, Textarea, cn } from '@crm/ui';
import type { FailureKey } from '../lib/failure';
import type { AssistantMode } from '../lib/prompt';
import type { ActivityLine, PanelState } from '../lib/state';

/** A guide offered as an answer. `steps` is filled in when the person asks to see them (undefined = not asked, null = none). */
export interface GuideCardData {
  id: string;
  title: string;
  summary: string;
  href: string;
}

export interface PanelViewProps {
  state: PanelState;
  draft: string;
  onDraft: (value: string) => void;
  /** The assistant is off on this screen (customer text lives here). */
  disabledHere: boolean;
  noticeAccepted: boolean;
  onAcceptNotice: () => void;
  prompts: string[];
  guides: GuideCardData[];
  stepsById: Record<string, string[] | null | undefined>;
  onLoadSteps: (id: string) => void;
  onSubmit: (mode: AssistantMode, task?: string) => void;
  onStop: () => void;
  onAllow: () => void;
  onDeny: () => void;
  onAnswer: (text: string) => void;
  onReset: () => void;
  onClose: () => void;
  maxSteps: number;
  /** Where the panel sits; the launcher uses `floating`, a test or a page can use `inline`. */
  variant?: 'floating' | 'inline';
}

const ERROR_KEYS: Record<FailureKey, string> = {
  disabled: 'errors.disabled',
  planLocked: 'errors.planLocked',
  forbidden: 'errors.forbidden',
  rateLimited: 'errors.rateLimited',
  taskLimit: 'errors.taskLimit',
  stepLimit: 'errors.stepLimit',
  closed: 'errors.closed',
  providerDown: 'errors.providerDown',
  monthlyLimit: 'errors.monthlyLimit',
  signedOut: 'errors.signedOut',
  network: 'errors.network',
  generic: 'errors.generic',
};

function ActivityText({ line }: { line: ActivityLine }) {
  const t = useTranslations('help-agent');
  return <>{t(`activity.${line.kind}`, { label: line.label })}</>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Notice({ onAccept }: { onAccept: () => void }) {
  const t = useTranslations('help-agent');
  return (
    <div className="space-y-3" data-testid="assistant-notice">
      <h3 className="text-base font-semibold">{t('notice.title')}</h3>
      <ul className="list-disc space-y-1.5 ps-5 text-sm text-muted-foreground">
        <li>{t('notice.sent')}</li>
        <li>{t('notice.masked')}</li>
        <li>{t('notice.asks')}</li>
        <li>{t('notice.limits')}</li>
      </ul>
      <Button onClick={onAccept} className="w-full">
        {t('notice.accept')}
      </Button>
    </div>
  );
}

function GuideCards({
  guides,
  stepsById,
  onLoadSteps,
  onSubmit,
  disabled,
  onClose,
}: Pick<PanelViewProps, 'guides' | 'stepsById' | 'onLoadSteps' | 'onSubmit' | 'onClose'> & {
  disabled: boolean;
}) {
  const t = useTranslations('help-agent');
  if (guides.length === 0) return null;
  return (
    <Section title={t('panel.guidesTitle')}>
      <ul className="space-y-2" data-testid="assistant-guides">
        {guides.map((g) => {
          const steps = g.id in stepsById ? stepsById[g.id] : undefined;
          return (
            <li key={g.id} className="rounded-lg border border-border bg-background p-3">
              <p className="text-sm font-semibold">{g.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{g.summary}</p>
              {steps ? (
                <ol className="mt-2 list-decimal space-y-1 ps-5 text-xs">
                  {steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {steps === undefined ? (
                  <Button size="sm" variant="secondary" onClick={() => onLoadSteps(g.id)}>
                    {t('panel.showSteps')}
                  </Button>
                ) : null}
                <Link
                  href={g.href}
                  onClick={onClose}
                  className="text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t('panel.openGuide')}
                </Link>
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => onSubmit('do', g.title)}
                  className="ms-auto"
                >
                  {t('panel.doItForMe')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function StepList({ state, maxSteps }: { state: PanelState; maxSteps: number }) {
  const t = useTranslations('help-agent');
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [state.steps.length, state.activity]);
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-xs text-muted-foreground" data-testid="assistant-progress">
        {t('status.progress', {
          n: Math.min(state.steps.length + (state.thinking ? 1 : 0), maxSteps),
          max: maxSteps,
        })}
      </p>
      <ol className="max-h-52 space-y-1.5 overflow-y-auto text-sm" data-testid="assistant-steps">
        {state.steps.map((s) => (
          <li key={s.n} className="flex gap-2">
            <span className="mt-0.5 size-4 shrink-0 rounded-full bg-primary/15 text-center text-[10px] leading-4 text-primary">
              {s.n}
            </span>
            <span>{s.goal || s.action}</span>
          </li>
        ))}
        <li ref={endRef} className="flex items-center gap-2 text-muted-foreground">
          {state.thinking || state.phase === 'starting' ? (
            <>
              <Spinner label={t('status.thinking')} />
              <span>
                {state.phase === 'starting' ? t('status.starting') : t('status.thinking')}
              </span>
            </>
          ) : state.activity ? (
            <span>
              <ActivityText line={state.activity} />
            </span>
          ) : null}
        </li>
      </ol>
    </div>
  );
}

function ConfirmCard({
  state,
  onAllow,
  onDeny,
}: Pick<PanelViewProps, 'state' | 'onAllow' | 'onDeny'>) {
  const t = useTranslations('help-agent');
  const request = state.confirm;
  if (!request) return null;
  return (
    <div
      role="alertdialog"
      aria-labelledby="assistant-confirm-title"
      aria-describedby="assistant-confirm-body"
      className="space-y-3 rounded-lg border-2 border-warning bg-warning/10 p-3"
      data-testid="assistant-confirm"
    >
      <h3 id="assistant-confirm-title" className="text-sm font-semibold">
        {t('confirm.title')}
      </h3>
      <p id="assistant-confirm-body" className="text-sm">
        {request.kind === 'select'
          ? t('confirm.selectBody', { label: request.label, detail: request.detail ?? '' })
          : t('confirm.clickBody', { label: request.label })}
      </p>
      <p className="text-xs text-muted-foreground">{t(`confirm.reasons.${request.reason}`)}</p>
      <div className="flex gap-2">
        {/* Deny is first and focused: pressing Enter by habit never allows anything. */}
        <Button variant="secondary" className="flex-1" onClick={onDeny} autoFocus>
          {t('confirm.deny')}
        </Button>
        <Button variant="primary" className="flex-1" onClick={onAllow}>
          {t('confirm.allow')}
        </Button>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  onAnswer,
}: {
  question: string;
  onAnswer: (text: string) => void;
}) {
  const t = useTranslations('help-agent');
  const [text, setText] = useState('');
  return (
    <form
      className="space-y-2 rounded-lg border border-border bg-muted p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onAnswer(text.trim());
      }}
      data-testid="assistant-question"
    >
      <h3 className="text-sm font-semibold">{t('question.title')}</h3>
      <p className="text-sm">{question}</p>
      <label className="block text-xs text-muted-foreground" htmlFor="assistant-answer">
        {t('question.answerLabel')}
      </label>
      <Textarea
        id="assistant-answer"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={text.trim() === ''}>
        {t('question.send')}
      </Button>
    </form>
  );
}

function ErrorCard({ state, onReset }: Pick<PanelViewProps, 'state' | 'onReset'>) {
  const t = useTranslations('help-agent');
  const error = state.error;
  if (!error) return null;
  return (
    <div className="space-y-3" data-testid="assistant-error">
      <Alert tone="danger">
        <p className="font-medium">{t(ERROR_KEYS[error.key])}</p>
        {error.retryAfter ? (
          <p className="mt-1 text-xs">{t('errors.retryIn', { seconds: error.retryAfter })}</p>
        ) : null}
        {error.requestId ? (
          <p className="mt-2 break-all font-mono text-xs" data-testid="assistant-request-id">
            {t('errors.requestId', { id: error.requestId })}
          </p>
        ) : null}
      </Alert>
      <Button variant="secondary" size="sm" onClick={onReset}>
        {t('panel.tryAgain')}
      </Button>
    </div>
  );
}

function ResultCard({ state, onReset }: Pick<PanelViewProps, 'state' | 'onReset'>) {
  const t = useTranslations('help-agent');
  const r = state.result;
  if (!r) return null;
  const title =
    r.stoppedBy === 'person'
      ? t('result.stoppedTitle')
      : r.outcome === 'completed'
        ? t('result.completedTitle')
        : t('result.failedTitle');
  return (
    <div className="space-y-3" data-testid="assistant-result">
      <Alert tone={r.outcome === 'completed' ? 'success' : 'info'}>
        <p className="font-medium">{title}</p>
        {r.stoppedBy === 'budget' ? <p className="mt-1">{t('stopped.budget')}</p> : null}
        {r.stoppedBy === 'location' ? <p className="mt-1">{t('stopped.location')}</p> : null}
        {r.stoppedBy === 'person' ? <p className="mt-1">{t('stopped.person')}</p> : null}
        {!r.stoppedBy && r.message ? <p className="mt-1 whitespace-pre-wrap">{r.message}</p> : null}
      </Alert>
      <p className="text-xs text-muted-foreground">
        {t('result.summary', { steps: r.steps, confirmed: r.confirmed, denied: r.denied })}
      </p>
      <Button variant="secondary" size="sm" onClick={onReset}>
        {t('panel.newTask')}
      </Button>
    </div>
  );
}

/**
 * The assistant panel as a pure view of its state: idle (the task box, examples and the guides that answer the question), running
 * (the live steps and Stop), awaiting a confirmation or an answer, finished, failed, or off on this screen. Nothing in it fetches or acts.
 */
export function AssistantPanelView(props: PanelViewProps) {
  const t = useTranslations('help-agent');
  const { state, draft, onDraft, disabledHere, noticeAccepted } = props;
  const running = state.phase === 'starting' || state.phase === 'running';
  const tooLong = draft.length > HELP_AGENT_MAX_TASK_CHARS;
  const canSubmit = draft.trim() !== '' && !tooLong && !disabledHere;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('panel.title')}
      // The assistant's own panel is never part of the page it reads.
      data-page-agent-ignore="true"
      data-testid="assistant-panel"
      className={cn(
        'z-50 flex flex-col overflow-hidden border border-border bg-background text-foreground shadow-xl',
        props.variant === 'inline'
          ? 'w-full max-w-md rounded-[14px]'
          : 'fixed bottom-0 end-0 max-h-[min(42rem,100dvh)] w-full rounded-t-[14px] sm:bottom-4 sm:end-4 sm:w-[26rem] sm:rounded-[14px]',
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">{t('panel.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('panel.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label={t('panel.close')}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!noticeAccepted ? (
          <Notice onAccept={props.onAcceptNotice} />
        ) : state.phase === 'error' ? (
          <ErrorCard state={state} onReset={props.onReset} />
        ) : state.phase === 'finished' ? (
          <ResultCard state={state} onReset={props.onReset} />
        ) : running ? (
          <>
            <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="assistant-task">
              {state.task}
            </p>
            <StepList state={state} maxSteps={props.maxSteps} />
            <ConfirmCard
              key={state.confirm?.id}
              state={state}
              onAllow={props.onAllow}
              onDeny={props.onDeny}
            />
            {state.question ? (
              <QuestionCard question={state.question} onAnswer={props.onAnswer} />
            ) : null}
          </>
        ) : (
          <>
            {disabledHere ? (
              <Alert tone="warning" data-testid="assistant-disabled">
                {t('panel.disabledHere')}
              </Alert>
            ) : null}
            <div className="space-y-2">
              <label htmlFor="assistant-task" className="block text-sm font-medium">
                {t('panel.taskLabel')}
              </label>
              <Textarea
                id="assistant-task"
                rows={3}
                value={draft}
                maxLength={HELP_AGENT_MAX_TASK_CHARS + 50}
                invalid={tooLong}
                disabled={disabledHere}
                placeholder={t('panel.taskPlaceholder')}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSubmit)
                    props.onSubmit('do');
                }}
              />
              {tooLong ? (
                <p className="text-xs text-danger">
                  {t('panel.tooLong', { max: HELP_AGENT_MAX_TASK_CHARS })}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!canSubmit}
                  onClick={() => props.onSubmit('do')}
                  className="flex-1"
                >
                  {t('panel.doItForMe')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canSubmit}
                  onClick={() => props.onSubmit('show')}
                  className="flex-1"
                >
                  {t('panel.showMe')}
                </Button>
              </div>
            </div>
            <GuideCards
              guides={props.guides}
              stepsById={props.stepsById}
              onLoadSteps={props.onLoadSteps}
              onSubmit={props.onSubmit}
              onClose={props.onClose}
              disabled={disabledHere}
            />
            {props.prompts.length > 0 && !disabledHere ? (
              <Section title={t('panel.examplesTitle')}>
                <ul className="flex flex-wrap gap-2" data-testid="assistant-prompts">
                  {props.prompts.map((p) => (
                    <li key={p}>
                      <button
                        type="button"
                        onClick={() => onDraft(p)}
                        className="rounded-full border border-border px-3 py-1 text-start text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </>
        )}
      </div>

      {running ? (
        <footer className="border-t border-border px-4 py-3">
          <Button
            variant="danger"
            className="w-full"
            onClick={props.onStop}
            disabled={state.stopping}
          >
            {state.stopping ? t('panel.stopping') : t('panel.stop')}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
