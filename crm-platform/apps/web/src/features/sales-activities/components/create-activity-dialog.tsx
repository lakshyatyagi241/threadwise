'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, Modal, Select, Spinner } from '@crm/ui';
import {
  ACTIVITY_ICONS,
  ACTIVITY_NAME_MAX,
  CUSTOM_ACTIVITY_BEHAVIOURS,
  ERROR_CODES,
  type SalesActivityType,
  type CreateActivityTypeInput,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { activityTypesApi, useActivityMutation } from '../api/activity-types';
import { ActivityIcon } from './activity-icon';

type Behaviour = (typeof CUSTOM_ACTIVITY_BEHAVIOURS)[number];

/** "Create activity": a name, an icon from the small set, and whether it behaves like a task, a meeting or a phone call. */
export function CreateActivityDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (a: SalesActivityType) => void;
}) {
  const t = useTranslations('sales-activities.create');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<(typeof ACTIVITY_ICONS)[number]>('task');
  const [behavesAs, setBehavesAs] = useState<Behaviour>('task');
  const [error, setError] = useState<string | null>(null);
  const create = useActivityMutation(
    (v: CreateActivityTypeInput) => activityTypesApi.create(v) as Promise<SalesActivityType>,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return setError(t('errors.nameRequired'));
    setError(null);
    create.mutate(
      { name: v, icon, behavesAs },
      {
        onSuccess: (a) => onCreated(a as SalesActivityType),
        onError: (err) => {
          const code = err instanceof ApiError ? err.code : '';
          setError(
            code === ERROR_CODES.ACTIVITY_NAME_TAKEN
              ? t('errors.nameTaken')
              : code === ERROR_CODES.ACTIVITY_LIMIT_REACHED
                ? t('errors.limit')
                : t('errors.failed'),
          );
        },
      },
    );
  };

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!create.isPending) onClose();
      }}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            onClick={(e) => submit(e as unknown as FormEvent)}
            disabled={create.isPending}
          >
            {create.isPending && <Spinner />}
            {t('create')}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <Field label={t('name')} htmlFor="new-activity-name" error={error ?? undefined}>
          <Input
            id="new-activity-name"
            autoFocus
            value={name}
            maxLength={ACTIVITY_NAME_MAX}
            dir="auto"
            invalid={!!error}
            placeholder={t('namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label={t('behavesAs')}
          htmlFor="new-activity-behaves"
          hint={t(`behavesAsHint.${behavesAs}`)}
        >
          <Select
            id="new-activity-behaves"
            value={behavesAs}
            onChange={(e) => setBehavesAs(e.target.value as Behaviour)}
          >
            {CUSTOM_ACTIVITY_BEHAVIOURS.map((b) => (
              <option key={b} value={b}>
                {t(`behaves.${b}`)}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t('icon')}</legend>
          <div role="radiogroup" aria-label={t('icon')} className="flex flex-wrap gap-2">
            {ACTIVITY_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={icon === i}
                aria-label={t(`icons.${i}`)}
                title={t(`icons.${i}`)}
                onClick={() => setIcon(i)}
                className={`inline-flex size-9 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  icon === i
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                <ActivityIcon name={i} />
              </button>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
