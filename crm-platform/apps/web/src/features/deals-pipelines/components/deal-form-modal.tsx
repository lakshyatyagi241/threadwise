'use client';

import { createDealSchema } from '@crm/contracts';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, Modal, Select, Spinner } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useMembers } from '../api/hooks';
import { dealsApi } from '../api/service';
import type { ContactRef, Deal, Pipeline } from '../api/schemas';
import { currencyChoices, toMajorInput, toMinor } from '../lib/money';
import { fieldErrors } from '../lib/errors';
import { ContactPicker } from './contact-picker';
import { useErrorText } from './parts';

export interface DealFormModalProps {
  pipeline: Pipeline;
  /** The stage the new deal starts in (the "+" of a column), else the first one. */
  stageId?: string;
  onClose: () => void;
  onCreated: (deal: Deal) => void;
}

type FormField = 'title' | 'value' | 'currency' | 'stage' | 'owner' | 'close' | 'form';

/** "New deal" (TW-DEAL-009). Mount it only while it is open: it starts empty every time. */
export function DealFormModal({ pipeline, stageId, onClose, onCreated }: DealFormModalProps) {
  const t = useTranslations('deals-pipelines.form');
  const session = useSession();
  const members = useMembers();
  const errorText = useErrorText();
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(pipeline.currency);
  const [stage, setStage] = useState(stageId ?? pipeline.stages[0]?.id ?? '');
  const [owner, setOwner] = useState(session.user.id);
  const [contact, setContact] = useState<ContactRef | null>(null);
  const [close, setClose] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next: Partial<Record<FormField, string>> = {};
    const minor = toMinor(value, currency);
    if (title.trim() === '') next.title = t('errors.titleRequired');
    if (Number.isNaN(minor)) next.value = t('errors.valueInvalid');
    else if (minor > 9_999_999_999) next.value = t('errors.valueTooLarge');
    const parsed = createDealSchema.safeParse({
      title,
      pipelineId: pipeline.id,
      stageId: stage || undefined,
      value: Number.isNaN(minor) ? undefined : toMajorInput(minor, currency),
      currency,
      ownerId: owner || null,
      contactId: contact?.id ?? null,
      expectedCloseDate: close || null,
    });
    if (Object.keys(next).length > 0 || !parsed.success) {
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onCreated(await dealsApi.createDeal(parsed.data, pipeline.currency));
    } catch (e) {
      const server = fieldErrors(e);
      setErrors({
        title: server.title ? t('errors.titleRequired') : undefined,
        value: server.value ? t('errors.valueInvalid') : undefined,
        stage: server.stageId ? t('errors.stageInvalid') : undefined,
        form: Object.keys(server).length === 0 ? errorText(e) : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={pipeline.name}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner />}
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {errors.form && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {errors.form}
          </p>
        )}
        <Field
          label={t('titleLabel')}
          htmlFor="deal-title"
          error={errors.title}
          className="sm:col-span-2"
        >
          <Input
            id="deal-title"
            autoFocus
            maxLength={191}
            value={title}
            invalid={!!errors.title}
            placeholder={t('titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t('value')} htmlFor="deal-value" error={errors.value}>
          <Input
            id="deal-value"
            inputMode="decimal"
            value={value}
            invalid={!!errors.value}
            placeholder="0.00"
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <Field label={t('currency')} htmlFor="deal-currency">
          <Select id="deal-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencyChoices(pipeline.currency).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('stage')} htmlFor="deal-stage" error={errors.stage}>
          <Select id="deal-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {pipeline.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('owner')} htmlFor="deal-owner">
          <Select id="deal-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t('unassigned')}</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === session.user.id ? t('me', { name: m.fullName }) : m.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('contact')}
          htmlFor="deal-contact"
          hint={t('contactHint')}
          className="sm:col-span-2"
        >
          <ContactPicker id="deal-contact" value={contact} onChange={setContact} />
        </Field>
        <Field label={t('expectedClose')} htmlFor="deal-close" className="sm:col-span-2">
          <Input
            id="deal-close"
            type="date"
            value={close}
            onChange={(e) => setClose(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
