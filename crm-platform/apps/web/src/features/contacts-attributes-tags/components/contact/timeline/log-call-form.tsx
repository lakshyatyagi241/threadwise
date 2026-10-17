'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTimeZone, useTranslations } from 'next-intl';
import { Button, Input, Spinner, Switch, Textarea, cn, useToast } from '@crm/ui';
import { useLogCall } from '../../../api/call-log';
import type { ContactRow } from '../../../api/schemas';
import {
  CALL_DIRECTIONS,
  CALL_NOTES_MAX,
  CALL_OUTCOMES,
  buildLogCallRequest,
  emptyCallDraft,
  type CallDraft,
  type CallProblem,
} from '../../../lib/call-log';
import { errorKind } from '../../../lib/errors';
import { addMinutes } from '../../../lib/meeting-inline';
import { isoToZonedLocal } from '../../../lib/meeting-time';
import { settlePendingCall } from '../call-nudge';

const choice =
  'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary';

/** A set of choices of which exactly one is on, drawn as chips (a radio group: arrow keys move between them). */
function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; text: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const at = options.findIndex((x) => x.value === value);
              const step =
                e.key === 'ArrowRight' || e.key === 'ArrowDown'
                  ? 1
                  : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (step === 0) return;
              e.preventDefault();
              const next = options[(at + step + options.length) % options.length]!;
              onChange(next.value);
              (
                e.currentTarget.parentElement?.querySelectorAll('[role="radio"]')[
                  options.indexOf(next)
                ] as HTMLElement | undefined
              )?.focus();
            }}
            className={cn(
              choice,
              on
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Log a call", in the compose box (no dialog): who called whom (outgoing to begin with), how it went, when (just now to begin with),
 * how long (optional), what was said, and a follow-up task if one is wanted. Enter in a field or the button logs it. Nothing the person
 * typed is lost when the server refuses: the reason shows and the form stays. A call logged here is a statement by a person, not a
 * measurement; it is written to the contact's timeline by the server.
 */
export function LogCallForm({
  contact,
  focusSignal,
  clickedAt,
  onSaved,
}: {
  contact: Pick<ContactRow, 'id'>;
  /** Changes whenever something outside (the Call button's "Log a call") wants the cursor in the form. */
  focusSignal?: number;
  /** The prompt "How did the call go?": the call started when the phone number was clicked. */
  clickedAt?: number;
  onSaved?: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.logCall');
  const { toast } = useToast();
  const timeZone = useTimeZone();
  const log = useLogCall(contact.id);
  const id = useId();
  const root = useRef<HTMLFormElement>(null);
  const notes = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<CallDraft>(() => emptyCallDraft(new Date(), timeZone));
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A client's own id for this attempt, so a double click (or a retry after a lost answer) logs one call.
  const [attempt, setAttempt] = useState(() => crypto.randomUUID());

  // The prompt after a click on a phone number: the call began when the person clicked.
  const [seenClick, setSeenClick] = useState<number | undefined>(undefined);
  if (clickedAt !== seenClick) {
    setSeenClick(clickedAt);
    if (clickedAt) {
      setDraft((d) => ({
        ...d,
        direction: 'outbound',
        when: isoToZonedLocal(new Date(clickedAt).toISOString(), timeZone),
      }));
    }
  }

  useEffect(() => {
    if (!focusSignal) return;
    const frame = window.requestAnimationFrame(() => {
      notes.current?.focus();
      root.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSignal]);

  const built = buildLogCallRequest(contact.id, draft, {
    now: new Date(),
    timeZone,
    source: clickedAt ? 'web_click_to_call' : 'manual',
  });
  const problem: CallProblem | null = built.ok ? null : built.problem;
  const shown = tried ? problem : null;
  const set = (patch: Partial<CallDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (failure) setFailure(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (log.isPending) return;
    setTried(true);
    if (!built.ok) return;
    log.mutate(
      { ...built.input, externalId: attempt },
      {
        onSuccess: () => {
          toast(t('saved'), 'success');
          settlePendingCall(contact.id);
          setDraft(emptyCallDraft(new Date(), timeZone));
          setTried(false);
          setFailure(null);
          setAttempt(crypto.randomUUID());
          onSaved?.();
        },
        onError: (err) => {
          const kind = errorKind(err);
          setFailure(
            kind === 'forbidden'
              ? t('forbidden')
              : kind === 'unavailable'
                ? t('unavailable')
                : t('failed'),
          );
        },
      },
    );
  };

  const problemText = (p: CallProblem | null) => (p ? t(`problem.${p}`) : undefined);
  const dueOf = (days: number) => addMinutes(`${draft.when.slice(0, 10)}T09:00`, days * 24 * 60);

  return (
    <form ref={root} aria-label={t('label')} noValidate onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Choices
          label={t('direction')}
          value={draft.direction}
          disabled={log.isPending}
          onChange={(direction) => set({ direction })}
          options={CALL_DIRECTIONS.map((v) => ({ value: v, text: t(`directionOption.${v}`) }))}
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground" id={`${id}-outcome`}>
          {t('outcome')}
        </p>
        <Choices
          label={t('outcome')}
          value={draft.outcome}
          disabled={log.isPending}
          onChange={(outcome) => set({ outcome })}
          options={CALL_OUTCOMES.map((v) => ({ value: v, text: t(`outcomeOption.${v}`) }))}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1" htmlFor={`${id}-when`}>
          <span className="text-xs font-medium text-muted-foreground">{t('when')}</span>
          <Input
            id={`${id}-when`}
            type="datetime-local"
            value={draft.when}
            invalid={shown === 'badWhen' || shown === 'futureWhen'}
            disabled={log.isPending}
            onChange={(e) => set({ when: e.target.value })}
          />
        </label>
        <label className="block space-y-1" htmlFor={`${id}-minutes`}>
          <span className="text-xs font-medium text-muted-foreground">{t('minutes')}</span>
          <Input
            id={`${id}-minutes`}
            inputMode="decimal"
            value={draft.minutes}
            placeholder={t('minutesPlaceholder')}
            invalid={shown === 'badMinutes'}
            disabled={log.isPending}
            onChange={(e) => set({ minutes: e.target.value })}
          />
        </label>
      </div>
      {(shown === 'badWhen' || shown === 'futureWhen' || shown === 'badMinutes') && (
        <p role="alert" className="text-xs text-danger">
          {problemText(shown)}
        </p>
      )}
      <div>
        <label htmlFor={`${id}-notes`} className="sr-only">
          {t('notes')}
        </label>
        <Textarea
          ref={notes}
          id={`${id}-notes`}
          rows={2}
          value={draft.notes}
          maxLength={CALL_NOTES_MAX}
          dir="auto"
          placeholder={t('notesPlaceholder')}
          readOnly={log.isPending}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            id={`${id}-follow`}
            checked={draft.followUp}
            disabled={log.isPending}
            onCheckedChange={(followUp) => set({ followUp })}
            label={t('followUp')}
          />
          <label htmlFor={`${id}-follow`} className="text-sm">
            {t('followUp')}
          </label>
        </div>
        {draft.followUp && (
          <div className="flex flex-wrap items-center gap-2 ps-14">
            <Input
              type="datetime-local"
              aria-label={t('due')}
              value={draft.due}
              invalid={shown === 'noDue' || shown === 'badDue'}
              disabled={log.isPending}
              onChange={(e) => set({ due: e.target.value })}
              className="w-auto min-w-44"
            />
            {([1, 3, 7] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => set({ due: dueOf(days) })}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t(`duePreset.${days}`)}
              </button>
            ))}
            {(shown === 'noDue' || shown === 'badDue') && (
              <p role="alert" className="w-full text-xs text-danger">
                {problemText(shown)}
              </p>
            )}
          </div>
        )}
      </div>
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={log.isPending}>
          {log.isPending && <Spinner />}
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
