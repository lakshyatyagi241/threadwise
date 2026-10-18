'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Field, Input, Select, Textarea, cn } from '@crm/ui';
import { ConsentNoticeEditor } from '@/features/contact-consent';
import {
  QUESTION_TYPES,
  TEMPLATE_EVENTS,
  type QuestionType,
  type TemplateEvent,
} from '../api/schemas';
import { LIMITS, type QuestionDraft } from '../lib/booking-form';
import { PLACEHOLDERS, insertAtRange, moveItem, newQuestion } from '../lib/editor';
import { REMINDER_MAX_RULES } from '../lib/reminder-rules';
import { useWaTemplates } from '../api/hooks';
import { ReminderRulesEditor } from './reminder-rules-editor';
import { SectionCard, chipClass, iconButtonClass, useEditor } from './editor-shared';
import { ChevronDownIcon, MinusIcon, PlusIcon } from './icons';

const MAP_FIELDS = ['email', 'name', 'mobile'] as const;

/** The placeholder tokens as literal text for a message's example (a value is never read as message syntax). */
const TOKEN_VALUES = {
  type: '{{type}}',
  slot: '{{slot}}',
  name: '{{name}}',
  manage_link: '{{manage_link}}',
} as const;

/** Step 5: the four lifecycle messages, the reminders, and the questions asked at booking. */
export function MessagingStep() {
  const { typeId } = useEditor();
  return (
    <div className="space-y-4">
      <LifecycleMessages />
      <Reminders />
      <Questionnaire />
      <ConsentNoticeEditor scope="booking" refId={typeId ?? ''} disabled={typeId === null} />
    </div>
  );
}

function LifecycleMessages() {
  const t = useTranslations('appointments.editor.messages');
  const { draft, update, fid, disabled } = useEditor();
  const refs = useRef<Partial<Record<TemplateEvent, HTMLTextAreaElement | null>>>({});
  const [active, setActive] = useState<TemplateEvent>('confirmation');

  const setBody = (event: TemplateEvent, plainBody: string) =>
    update((d) => ({
      ...d,
      templates: { ...d.templates, [event]: { ...d.templates[event], plainBody } },
    }));

  function insert(token: string) {
    const el = refs.current[active];
    const current = draft.templates[active].plainBody;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const result = insertAtRange(current, token, start, end, LIMITS.templateMax);
    if (!result) return;
    setBody(active, result.text);
    // put the caret after the inserted text once the box has its new value
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.caret, result.caret);
    });
  }

  return (
    <SectionCard title={t('title')} hint={t('hint')}>
      <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="text-xs font-medium">{t('placeholdersTitle')}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('placeholdersHint', { event: t(`events.${active}`) })}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PLACEHOLDERS.map((token) => (
            <button
              key={token}
              type="button"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(token)}
              className={cn(chipClass, 'font-mono')}
              title={t(
                `placeholderMeaning.${token.slice(2, -2) as 'type' | 'slot' | 'name' | 'manage_link'}`,
              )}
            >
              {token}
            </button>
          ))}
        </div>
        <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
          {PLACEHOLDERS.map((token) => (
            <li key={token}>
              <code dir="ltr" className="font-mono text-foreground">
                {token}
              </code>{' '}
              {t(
                `placeholderMeaning.${token.slice(2, -2) as 'type' | 'slot' | 'name' | 'manage_link'}`,
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        {TEMPLATE_EVENTS.map((event) => {
          const body = draft.templates[event].plainBody;
          return (
            <div
              key={event}
              className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3"
            >
              <label htmlFor={fid(`tpl-${event}`)} className="pt-2 text-sm font-semibold">
                {t(`events.${event}`)}
              </label>
              <div className="min-w-0">
                <Textarea
                  id={fid(`tpl-${event}`)}
                  ref={(el) => {
                    refs.current[event] = el;
                  }}
                  rows={3}
                  value={body}
                  maxLength={LIMITS.templateMax}
                  disabled={disabled}
                  placeholder={t(`placeholders.${event}`, TOKEN_VALUES)}
                  onFocus={() => setActive(event)}
                  onChange={(e) => setBody(event, e.target.value)}
                />
                <div
                  className="mt-1 flex justify-end text-xs text-muted-foreground tabular-nums"
                  dir="ltr"
                >
                  {body.length} / {LIMITS.templateMax}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Alert tone="info" className="mt-3 text-xs">
        {t('templatesNote')}
      </Alert>
    </SectionCard>
  );
}

function Reminders() {
  const t = useTranslations('appointments.reminders');
  const { draft, update, err, fid, disabled } = useEditor();
  const templates = useWaTemplates();
  return (
    <SectionCard title={t('title')} hint={t('hint', { max: REMINDER_MAX_RULES })}>
      <ReminderRulesEditor
        rules={draft.reminders}
        onChange={(next) => update((d) => ({ ...d, reminders: next }))}
        disabled={disabled}
        errorOf={err}
        typeName={draft.name}
        templates={templates.data ?? []}
        idPrefix={fid('reminders')}
      />
    </SectionCard>
  );
}

function Questionnaire() {
  const t = useTranslations('appointments.editor.questions');
  const { draft, set, update, err, fid, disabled } = useEditor();
  const list = draft.questions;
  const full = list.length >= LIMITS.questions;
  const setList = (fn: (l: QuestionDraft[]) => QuestionDraft[]) =>
    update((d) => ({ ...d, questions: fn(d.questions) }));
  const patch = (id: string, change: Partial<QuestionDraft>) =>
    setList((l) => l.map((q) => (q.id === id ? { ...q, ...change } : q)));
  const listError = err('questions');

  return (
    <SectionCard
      title={t('title')}
      hint={t('hint', { max: LIMITS.questions })}
      action={
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || full}
          onClick={() => setList((l) => [...l, newQuestion()])}
        >
          <PlusIcon /> {t('add')}
        </Button>
      }
    >
      <Field
        label={t('intro')}
        htmlFor={fid('introMessage')}
        hint={t('introHint')}
        className="mb-4"
      >
        <Textarea
          id={fid('introMessage')}
          rows={2}
          value={draft.introMessage}
          maxLength={LIMITS.introMax}
          disabled={disabled}
          onChange={(e) => set('introMessage', e.target.value)}
        />
      </Field>

      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ol className="space-y-3">
          {list.map((q, i) => {
            const error = err(`question:${q.id}`);
            const n = i + 1;
            const mapChoices: string[] =
              q.map && !(MAP_FIELDS as readonly string[]).includes(q.map) ? [q.map] : [];
            return (
              <li key={q.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                  >
                    {n}
                  </span>
                  <Input
                    id={fid(`question-${q.id}`)}
                    value={q.label}
                    invalid={!!error}
                    disabled={disabled}
                    maxLength={LIMITS.questionLabelMax}
                    placeholder={t('labelPlaceholder')}
                    aria-label={t('labelOf', { n })}
                    onChange={(e) => patch(q.id, { label: e.target.value })}
                    className="min-w-[10rem] flex-1"
                  />
                  <Select
                    value={q.type}
                    disabled={disabled}
                    aria-label={t('typeOf', { n })}
                    onChange={(e) => patch(q.id, { type: e.target.value as QuestionType })}
                    className="w-36"
                  >
                    {QUESTION_TYPES.map((qt) => (
                      <option key={qt} value={qt}>
                        {t(`types.${qt}`)}
                      </option>
                    ))}
                  </Select>
                </div>

                {q.type === 'select' && (
                  <div className="mt-2">
                    <Textarea
                      rows={3}
                      value={q.optionsText}
                      disabled={disabled}
                      invalid={error === undefined ? false : q.optionsText.trim() === ''}
                      aria-label={t('optionsOf', { n })}
                      placeholder={t('optionsPlaceholder')}
                      onChange={(e) => patch(q.id, { optionsText: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('optionsHint', { max: LIMITS.optionMax })}
                    </p>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t('map')}</span>
                    <Select
                      value={q.map}
                      disabled={disabled}
                      aria-label={t('mapOf', { n })}
                      onChange={(e) => patch(q.id, { map: e.target.value })}
                      className="h-9 w-40"
                    >
                      <option value="">{t('mapNone')}</option>
                      {[...MAP_FIELDS, ...mapChoices].map((f) => (
                        <option key={f} value={f}>
                          {(MAP_FIELDS as readonly string[]).includes(f)
                            ? t(`mapFields.${f as (typeof MAP_FIELDS)[number]}`)
                            : f}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <Checkbox
                    id={fid(`required-${q.id}`)}
                    checked={q.required}
                    disabled={disabled}
                    onChange={(e) => patch(q.id, { required: e.target.checked })}
                    label={t('required')}
                    className="items-center text-xs"
                  />
                  <div className="ms-auto flex items-center gap-1">
                    <button
                      type="button"
                      disabled={disabled || i === 0}
                      onClick={() => setList((l) => moveItem(l, i, -1))}
                      aria-label={t('moveUp', { n })}
                      title={t('moveUp', { n })}
                      className={iconButtonClass}
                    >
                      <ChevronDownIcon className="rotate-180" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || i === list.length - 1}
                      onClick={() => setList((l) => moveItem(l, i, 1))}
                      aria-label={t('moveDown', { n })}
                      title={t('moveDown', { n })}
                      className={iconButtonClass}
                    >
                      <ChevronDownIcon />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setList((l) => l.filter((x) => x.id !== q.id))}
                      aria-label={t('remove', { n })}
                      title={t('remove', { n })}
                      className={cn(iconButtonClass, 'hover:text-danger')}
                    >
                      <MinusIcon />
                    </button>
                  </div>
                </div>
                {error && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t('count', { count: list.length, max: LIMITS.questions })}</span>
        {listError && (
          <span role="alert" className="text-danger">
            {listError}
          </span>
        )}
      </div>
    </SectionCard>
  );
}
