'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Modal, Select, Textarea } from '@crm/ui';
import { useStatusOptions } from '../api/attributes';
import {
  OTHER_REASON,
  lostReasonChoices,
  lostReasonPayload,
  lostReasonProblem,
  type LostReasonAnswer,
} from '../lib/stage-flow';
import type { Choice } from '../lib/option-sets';

/** The workspace's lost reasons (Contact properties, group `lost_reason`); empty means "just ask for words". */
export function useLostReasonChoices(): Choice[] {
  const options = useStatusOptions();
  return lostReasonChoices(options.data);
}

/**
 * Why a contact was lost: pick one of the workspace's reasons, or "Other" and write it. A workspace with no reasons
 * configured only gets the text box. Shared by the move-to-lost dialog and the contact form.
 */
export function LostReasonFields({
  choices,
  value,
  onChange,
  problem,
  idPrefix,
}: {
  choices: readonly Choice[];
  value: LostReasonAnswer;
  onChange: (next: LostReasonAnswer) => void;
  problem?: 'pick' | 'text' | null;
  idPrefix: string;
}) {
  const t = useTranslations('contacts-attributes-tags.lost');
  const hasChoices = choices.length > 0;
  const showText = !hasChoices || value.pick === OTHER_REASON;
  return (
    <div className="space-y-3">
      {hasChoices && (
        <Field
          label={`${t('reason')} *`}
          htmlFor={`${idPrefix}-reason`}
          error={problem === 'pick' ? t('problem.pick') : undefined}
        >
          <Select
            id={`${idPrefix}-reason`}
            value={value.pick}
            invalid={problem === 'pick'}
            onChange={(e) => onChange({ ...value, pick: e.target.value })}
          >
            <option value="">{t('pick')}</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
            <option value={OTHER_REASON}>{t('other')}</option>
          </Select>
        </Field>
      )}
      {showText && (
        <Field
          label={`${hasChoices ? t('otherLabel') : t('reason')} *`}
          htmlFor={`${idPrefix}-text`}
          error={problem === 'text' ? t('problem.text') : undefined}
        >
          <Textarea
            id={`${idPrefix}-text`}
            value={value.text}
            maxLength={500}
            rows={3}
            invalid={problem === 'text'}
            placeholder={t('otherPlaceholder')}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}

export interface LostPrompt {
  /** The contact being moved, for the dialog's wording and the caller's save. */
  contactId: string;
  contactName: string;
  stageValue: string;
  stageLabel: string;
}

/**
 * Asked when a contact is moved to a lost stage from the table or the detail page: nothing is saved until a reason is
 * given. `onConfirm` receives the API fields for it (`lostReason` / `otherLostReason`).
 */
export function LostReasonDialog({
  prompt,
  busy,
  onConfirm,
  onClose,
}: {
  prompt: LostPrompt | null;
  busy?: boolean;
  onConfirm: (
    prompt: LostPrompt,
    fields: { lostReason?: string | null; otherLostReason?: string | null },
  ) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.lost');
  return (
    <Modal
      open={prompt !== null}
      onClose={onClose}
      title={t('title', { name: prompt?.contactName || t('contactFallback') })}
      closeLabel={t('close')}
    >
      {prompt && (
        <LostReasonForm
          key={`${prompt.contactId}:${prompt.stageValue}`}
          prompt={prompt}
          busy={busy}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function LostReasonForm({
  prompt,
  busy,
  onConfirm,
  onClose,
}: {
  prompt: LostPrompt;
  busy?: boolean;
  onConfirm: (p: LostPrompt, fields: ReturnType<typeof lostReasonPayload>) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.lost');
  const uid = useId();
  const choices = useLostReasonChoices();
  const [answer, setAnswer] = useState<LostReasonAnswer>({ pick: '', text: '' });
  const [problem, setProblem] = useState<'pick' | 'text' | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = lostReasonProblem(answer, choices.length > 0);
    setProblem(found);
    if (found) return;
    onConfirm(prompt, lostReasonPayload(answer, choices.length > 0));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('subtitle', { stage: prompt.stageLabel })}</p>
      <LostReasonFields
        choices={choices}
        value={answer}
        onChange={(a) => {
          setAnswer(a);
          setProblem(null);
        }}
        problem={problem}
        idPrefix={uid}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {t('confirm', { stage: prompt.stageLabel })}
        </Button>
      </div>
    </form>
  );
}
