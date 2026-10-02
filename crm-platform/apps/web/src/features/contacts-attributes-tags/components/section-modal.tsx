'use client';

import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { FieldSectionResponse } from '@crm/contracts';
import { Button, Field, Input, Modal, Spinner, useToast } from '@crm/ui';
import { createSection, invalidateProperties, renameSection } from '../api/properties';
import { ErrorLine } from './error-line';

/** New / rename a section of the contact properties. */
export function SectionModal({
  open,
  section,
  sections,
  onClose,
}: {
  open: boolean;
  /** Present = rename this section. */
  section?: FieldSectionResponse;
  sections: readonly FieldSectionResponse[];
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.properties');
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('section.eyebrow')}
      title={section ? t('section.renameTitle') : t('section.newTitle')}
      closeLabel={t('modal.close')}
    >
      {open && (
        <SectionForm
          key={section?.id ?? 'new'}
          section={section}
          sections={sections}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function SectionForm({
  section,
  sections,
  onClose,
}: {
  section?: FieldSectionResponse;
  sections: readonly FieldSectionResponse[];
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.properties');
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const [name, setName] = useState(section?.name ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => (section ? renameSection(section, name) : createSection(name)),
    onSuccess: async () => {
      await invalidateProperties(qc);
      toast(section ? t('section.renamed') : t('section.created'), 'success');
      onClose();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const taken = sections.some(
      (s) =>
        s.id !== section?.id && s.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
    );
    const found = !trimmed ? 'required' : trimmed.length > 255 ? 'tooLong' : taken ? 'taken' : null;
    setProblem(found ? t(`section.problem.${found}`) : null);
    if (!found) save.mutate();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {save.isError && <ErrorLine error={save.error} />}
      <Field
        label={`${t('section.name')} *`}
        htmlFor={`${uid}-name`}
        error={problem ?? undefined}
        hint={t('section.hint')}
      >
        <Input
          id={`${uid}-name`}
          value={name}
          maxLength={255}
          autoFocus
          invalid={Boolean(problem)}
          placeholder={t('section.placeholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('modal.cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          {section ? t('modal.save') : t('section.create')}
        </Button>
      </div>
    </form>
  );
}
