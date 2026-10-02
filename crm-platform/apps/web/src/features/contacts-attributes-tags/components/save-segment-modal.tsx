'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ERROR_CODES } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Spinner, cn, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { SEGMENT_ROUTES, invalidateSegments, segmentFromFilters } from '@/features/segments';

type Visibility = 'private' | 'shared';

/**
 * "Save these filters as a segment": names the segment and asks the API to turn the contacts list's active filters into
 * rules (the same translation the API uses everywhere). Then the rule builder opens on the new segment so its rules can
 * be refined, and the segment keeps itself up to date from then on.
 */
export function SaveSegmentModal({
  open,
  filter,
  onClose,
}: {
  open: boolean;
  /** The list's active filters in the API's filter shape (`contactFilterBody`). */
  filter: object;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.segmentSave');
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('eyebrow')}
      title={t('title')}
      closeLabel={t('close')}
    >
      {open && <SaveForm filter={filter} onClose={onClose} />}
    </Modal>
  );
}

function SaveForm({ filter, onClose }: { filter: object; onClose: () => void }) {
  const t = useTranslations('contacts-attributes-tags.segmentSave');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [missing, setMissing] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      segmentFromFilters({ name: name.trim(), visibility, filter } as Parameters<
        typeof segmentFromFilters
      >[0]),
    onSuccess: async (segment) => {
      await invalidateSegments(qc);
      toast(t('created', { name: segment.name }), 'success');
      onClose();
      router.push(SEGMENT_ROUTES.edit(segment.id));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setMissing(true);
      document.getElementById(`${uid}-name`)?.focus();
      return;
    }
    setMissing(false);
    save.mutate();
  }

  const code = save.error instanceof ApiError ? save.error.code : null;
  const taken = code === ERROR_CODES.SEG_NAME_TAKEN;
  const forbidden = code === ERROR_CODES.FORBIDDEN;
  const message = save.isError && !taken ? t(forbidden ? 'forbidden' : 'failed') : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {message && <Alert tone="danger">{message}</Alert>}
      <Field
        label={`${t('name')} *`}
        htmlFor={`${uid}-name`}
        error={missing ? t('nameRequired') : taken ? t('nameTaken') : undefined}
      >
        <Input
          id={`${uid}-name`}
          value={name}
          maxLength={191}
          autoFocus
          invalid={missing || taken}
          placeholder={t('namePlaceholder')}
          onChange={(e) => {
            setName(e.target.value);
            if (taken) save.reset();
          }}
        />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t('visibility')}</legend>
        <div role="radiogroup" aria-label={t('visibility')} className="grid gap-2 sm:grid-cols-2">
          {(['private', 'shared'] as const).map((v) => (
            <label
              key={v}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                visibility === v ? 'border-brand bg-brand/5' : 'border-border hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name={`${uid}-visibility`}
                checked={visibility === v}
                onChange={() => setVisibility(v)}
                className="mt-1 accent-[var(--brand)]"
              />
              <span>
                <span className="block font-medium">{t(v)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(v === 'private' ? 'privateHint' : 'sharedHint')}
                </span>
              </span>
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
