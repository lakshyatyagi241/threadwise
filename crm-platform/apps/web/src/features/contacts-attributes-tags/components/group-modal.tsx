'use client';

import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, Modal, Spinner, Textarea, cn, useToast } from '@crm/ui';
import { KEYS } from '../api/contacts';
import { createGroup, updateGroup } from '../api/groups';
import { GROUP_COLORS, type ContactGroup } from '../api/schemas';
import { errorKind, fieldErrors } from '../lib/errors';
import { ErrorLine } from './error-line';

/** Create or edit a group (WD-CON-034, 035): name, note, one of five accent colours. */
export function GroupModal({
  open,
  group,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Present = edit. */
  group?: ContactGroup;
  onClose: () => void;
  onSaved?: (g: ContactGroup) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.groups');
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('modalEyebrow')}
      title={group ? t('editTitle') : t('createTitle')}
      closeLabel={t('close')}
    >
      {open && (
        <GroupForm key={group?.id ?? 'new'} group={group} onClose={onClose} onSaved={onSaved} />
      )}
    </Modal>
  );
}

function GroupForm({
  group,
  onClose,
  onSaved,
}: {
  group?: ContactGroup;
  onClose: () => void;
  onSaved?: (g: ContactGroup) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.groups');
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const [name, setName] = useState(group?.name ?? '');
  const [note, setNote] = useState(group?.note ?? '');
  const [color, setColor] = useState(group?.color || GROUP_COLORS[0]);
  const [nameProblem, setNameProblem] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), note: note.trim() || null, color };
      return group ? updateGroup(group, body) : createGroup(body);
    },
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: KEYS.groups });
      // Creating a name that already exists returns that group untouched: say so rather than "created".
      const existing = 'existing' in saved && saved.existing;
      toast(
        group ? t('updated') : existing ? t('exists') : t('created'),
        existing ? 'info' : 'success',
      );
      onSaved?.(saved);
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameProblem(true);
      document.getElementById(`${uid}-name`)?.focus();
      return;
    }
    setNameProblem(false);
    save.mutate();
  }

  const kind = save.isError ? errorKind(save.error) : null;
  const serverName = save.isError ? fieldErrors(save.error).name : undefined;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {save.isError && kind !== 'validation' && kind !== 'nameTaken' && (
        <ErrorLine error={save.error} />
      )}
      <Field
        label={`${t('name')} *`}
        htmlFor={`${uid}-name`}
        error={nameProblem ? t('nameRequired') : kind === 'nameTaken' ? t('nameTaken') : serverName}
      >
        <Input
          id={`${uid}-name`}
          value={name}
          maxLength={191}
          autoFocus
          invalid={nameProblem || kind === 'nameTaken' || Boolean(serverName)}
          placeholder={t('namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t('note')} htmlFor={`${uid}-note`}>
        <Textarea
          id={`${uid}-note`}
          rows={3}
          maxLength={500}
          value={note}
          placeholder={t('notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t('color')}</legend>
        <div role="radiogroup" aria-label={t('color')} className="flex gap-2">
          {GROUP_COLORS.map((c) => (
            <label key={c} className="cursor-pointer">
              <input
                type="radio"
                name={`${uid}-color`}
                value={c}
                checked={color === c}
                onChange={() => setColor(c)}
                className="peer sr-only"
                aria-label={c}
              />
              <span
                aria-hidden="true"
                style={{ background: c }}
                className={cn(
                  'block size-8 rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-primary',
                )}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
