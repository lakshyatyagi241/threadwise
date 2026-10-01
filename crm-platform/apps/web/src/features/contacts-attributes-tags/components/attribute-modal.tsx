'use client';

import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Modal, Spinner, Switch, useToast } from '@crm/ui';
import { KEYS } from '../api/contacts';
import { createAttribute, updateAttribute } from '../api/attributes';
import {
  ATTRIBUTE_KEY_MAX,
  checkAttributeKey,
  suggestKey,
  type Attribute,
} from '../lib/attribute-model';
import { errorKind, fieldErrors } from '../lib/errors';
import { ErrorLine } from './error-line';

/** New / edit attribute (WD-CON-043, 044). The key is chosen once and then read-only; "Active" really switches it off. */
export function AttributeModal({
  open,
  attribute,
  onClose,
}: {
  open: boolean;
  /** Present = edit. */
  attribute?: Attribute;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.attributes');
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={attribute ? t('editEyebrow') : t('newEyebrow')}
      title={attribute ? t('editTitle') : t('createTitle')}
      closeLabel={t('close')}
    >
      {open && (
        <AttributeForm key={attribute?.id ?? 'new'} attribute={attribute} onClose={onClose} />
      )}
    </Modal>
  );
}

function AttributeForm({ attribute, onClose }: { attribute?: Attribute; onClose: () => void }) {
  const t = useTranslations('contacts-attributes-tags.attributes');
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const editing = attribute !== undefined;
  const [name, setName] = useState(attribute?.name ?? '');
  const [key, setKey] = useState(attribute?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(false);
  const [defaultValue, setDefaultValue] = useState(attribute?.defaultValue ?? '');
  const [description, setDescription] = useState(attribute?.description ?? '');
  const [active, setActive] = useState(attribute?.active ?? true);
  const [problems, setProblems] = useState<{ name?: string; key?: string }>({});
  const [conflict, setConflict] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      attribute
        ? updateAttribute(attribute, { name, defaultValue, description, active })
        : createAttribute({ name, key, defaultValue, description, active }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.attributes }),
        qc.invalidateQueries({ queryKey: KEYS.attributePicker }),
      ]);
      toast(editing ? t('updated') : t('created'), 'success');
      onClose();
    },
    onError: (e) => setConflict(errorKind(e) === 'conflict'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: { name?: string; key?: string } = {};
    if (!name.trim()) next.name = t('problem.nameRequired');
    if (!editing) {
      const k = checkAttributeKey(key);
      if (k) next.key = t(`problem.key.${k}`);
    }
    setProblems(next);
    if (next.name || next.key) {
      document.getElementById(`${uid}-${next.name ? 'name' : 'key'}`)?.focus();
      return;
    }
    save.mutate();
  }

  const kind = save.isError ? errorKind(save.error) : null;
  const server = save.isError ? fieldErrors(save.error) : {};

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">{editing ? t('keyLocked') : t('createHint')}</p>
      {conflict && <Alert tone="warning">{t('conflict')}</Alert>}
      {save.isError &&
        !conflict &&
        kind !== 'keyTaken' &&
        kind !== 'reservedKey' &&
        kind !== 'validation' && <ErrorLine error={save.error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          className="sm:col-span-2"
          label={`${t('name')} *`}
          htmlFor={`${uid}-name`}
          error={problems.name ?? server.name}
        >
          <Input
            id={`${uid}-name`}
            value={name}
            maxLength={120}
            autoFocus
            invalid={Boolean(problems.name ?? server.name)}
            placeholder={t('namePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
              if (!editing && !keyTouched) setKey(suggestKey(e.target.value));
            }}
          />
        </Field>
        <Field
          label={editing ? t('key') : `${t('key')} *`}
          htmlFor={`${uid}-key`}
          hint={editing ? t('readOnly') : t('keyHint')}
          error={
            problems.key ??
            (kind === 'keyTaken'
              ? t('problem.key.taken')
              : kind === 'reservedKey'
                ? t('problem.key.reserved')
                : server.key)
          }
        >
          <Input
            id={`${uid}-key`}
            value={key}
            maxLength={ATTRIBUTE_KEY_MAX}
            disabled={editing}
            dir="ltr"
            className="font-mono"
            invalid={Boolean(problems.key) || kind === 'keyTaken' || kind === 'reservedKey'}
            placeholder="order_id"
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toLowerCase());
            }}
          />
        </Field>
        <Field label={t('defaultValue')} htmlFor={`${uid}-default`}>
          <Input
            id={`${uid}-default`}
            value={defaultValue}
            maxLength={255}
            placeholder={t('defaultPlaceholder')}
            onChange={(e) => setDefaultValue(e.target.value)}
          />
        </Field>
        <Field className="sm:col-span-2" label={t('description')} htmlFor={`${uid}-desc`}>
          <Input
            id={`${uid}-desc`}
            value={description}
            maxLength={500}
            placeholder={t('descriptionPlaceholder')}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3 sm:col-span-2">
          <label htmlFor={`${uid}-active`} className="min-w-0 text-sm">
            <span className="block font-medium">{t('active')}</span>
            <span className="text-xs text-muted-foreground">{t('activeHint')}</span>
          </label>
          <Switch
            id={`${uid}-active`}
            checked={active}
            onCheckedChange={setActive}
            label={t('active')}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          {editing ? t('saveChanges') : t('save')}
        </Button>
      </div>
    </form>
  );
}
