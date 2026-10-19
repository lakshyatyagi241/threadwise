'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  CALL_ENTRY_DIRECTIONS,
  CALL_MAX_DURATION_SEC,
  CALL_NOTES_MAX,
  CALL_OUTCOMES,
  type CallLogPrefill,
  type LogCallInput,
  type LogCallResult,
} from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from '@crm/ui';
import { useActivityLabels, useActivitySettings } from '@/features/sales-activities';
import { useLogCall } from '../api/call-logging';
import { buildLogCallInput, localDateTimeValue, tomorrowMorning } from '../lib/log-call';
import { useErrorText } from './use-error-text';

export interface LogCallDialogProps {
  open: boolean;
  onClose: () => void;
  /** A contact to log the call on (the contact page passes it). Without one the call is matched to a contact by its number. */
  contactId?: string;
  /** Shown as the person the call is with, when `contactId` is given. */
  contactName?: string;
  /** Values to start from: the "did you call? log it" prompt passes `callLogPrefill(...)`. */
  prefill?: Partial<CallLogPrefill>;
  onLogged?: (result: LogCallResult) => void;
}

/**
 * "Log a call": a call that was not a WhatsApp call (a phone call, a call on the telephony line). Mount it anywhere with the contact or
 * without one; the server finds the contact by the number among the contacts the person may read. Saving never changes the contact's
 * stage and never asks the Do-Not-Call list: logging records what happened. Needs `call.logs.create` (the server enforces it).
 */
export function LogCallDialog(props: LogCallDialogProps) {
  const t = useTranslations('calling-voice.logs.logCall');
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t('title')}
      closeLabel={t('close')}
      size="md"
    >
      {props.open && <LogCallForm {...props} />}
    </Modal>
  );
}

function LogCallForm({ onClose, contactId, contactName, prefill, onLogged }: LogCallDialogProps) {
  const t = useTranslations('calling-voice.logs.logCall');
  const tf = useTranslations('calling-voice.logs.filters');
  const { toast } = useToast();
  const errorText = useErrorText();
  const save = useLogCall();
  const id = useId();
  const [phone, setPhone] = useState(prefill?.customerPhone ?? '');
  const [direction, setDirection] = useState<(typeof CALL_ENTRY_DIRECTIONS)[number]>(
    prefill?.direction ?? 'outbound',
  );
  const [outcome, setOutcome] = useState<(typeof CALL_OUTCOMES)[number]>('connected');
  // The workspace's own Phone outcomes (Settings > Sales Activities); until they load, or if they cannot be read, the built-in seven.
  const phoneActivity = useActivitySettings('phone').activity;
  const activityLabels = useActivityLabels();
  const items = phoneActivity?.outcomes ?? [];
  const [optionId, setOptionId] = useState('');
  const chosen = items.find((o) => o.id === optionId) ?? items.find((o) => o.key === 'connected') ?? items[0];
  const [when, setWhen] = useState(
    localDateTimeValue(prefill?.startedAt ? new Date(prefill.startedAt) : new Date()),
  );
  const [minutes, setMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [due, setDue] = useState(localDateTimeValue(tomorrowMorning()));
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const built = buildLogCallInput({
      contactId: contactId ?? prefill?.contactId,
      phone,
      direction,
      outcome: chosen ? ((chosen.countsAs ?? chosen.key) as typeof outcome) : outcome,
      when,
      minutes,
      notes,
      followUp: followUp ? { due } : null,
      source: prefill?.source,
    });
    if (!built.ok) {
      setProblem(t(`problems.${built.problem}`));
      return;
    }
    try {
      const input: LogCallInput = chosen ? { ...built.input, outcomeOptionId: chosen.id } : built.input;
      const result = await save.mutateAsync(input);
      toast(result.entry.contactId ? t('saved') : t('savedNoContact'), 'success');
      onLogged?.(result);
      onClose();
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const named = contactId ?? prefill?.contactId;
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      {named && contactName && (
        <p className="text-sm">
          {t('with')} <strong>{contactName}</strong>
        </p>
      )}
      <Field
        label={t('phone')}
        htmlFor={`${id}-phone`}
        hint={named ? t('phoneHintContact') : t('phoneHint')}
      >
        <Input
          id={`${id}-phone`}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={32}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('direction')} htmlFor={`${id}-direction`}>
          <Select
            id={`${id}-direction`}
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            {CALL_ENTRY_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {tf(d)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('outcome')} htmlFor={`${id}-outcome`}>
          {chosen ? (
            <Select
              id={`${id}-outcome`}
              value={chosen.id}
              onChange={(e) => setOptionId(e.target.value)}
            >
              {items.map((o) => (
                <option key={o.id} value={o.id}>
                  {activityLabels.option('phone', o)}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              id={`${id}-outcome`}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as typeof outcome)}
            >
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {t(`outcomes.${o}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('when')} htmlFor={`${id}-when`}>
          <Input
            id={`${id}-when`}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label={t('minutes')} htmlFor={`${id}-minutes`}>
          <Input
            id={`${id}-minutes`}
            type="number"
            inputMode="decimal"
            min={0}
            max={CALL_MAX_DURATION_SEC / 60}
            step="any"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('notes')} htmlFor={`${id}-notes`} hint={t('notesHint')}>
        <Textarea
          id={`${id}-notes`}
          rows={3}
          maxLength={CALL_NOTES_MAX}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="space-y-2">
        <Checkbox
          id={`${id}-follow`}
          label={t('followUp')}
          checked={followUp}
          onChange={(e) => setFollowUp(e.target.checked)}
        />
        {followUp && (
          <Field label={t('followUpDue')} htmlFor={`${id}-due`} hint={t('followUpHint')}>
            <Input
              id={`${id}-due`}
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
        )}
      </div>
      {problem && <Alert tone="danger">{problem}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="brand" disabled={save.isPending}>
          {save.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}
