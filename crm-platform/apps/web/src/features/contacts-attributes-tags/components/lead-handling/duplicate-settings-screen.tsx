'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type {
  DuplicateSettings,
  DuplicateSettingsValues,
  LeadHandlingSettings,
} from '@crm/contracts';
import { Alert, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  LEAD_HANDLING_KEYS,
  leadHandlingApi,
  useLeadHandlingSettings,
} from '../../api/lead-handling';
import {
  RadioRow,
  SettingsFrame,
  SettingsPage,
  SettingsSection,
  ToggleRow,
  isVersionConflict,
  settingsErrorKey,
} from './settings-parts';

export function valuesOf(s: DuplicateSettings | DuplicateSettingsValues): DuplicateSettingsValues {
  return { mode: s.mode, noteOnMerge: s.noteOnMerge };
}

export const sameDuplicates = (a: DuplicateSettingsValues, b: DuplicateSettingsValues): boolean =>
  a.mode === b.mode && a.noteOnMerge === b.noteOnMerge;

/** `/duplicate-leads`: what happens to a new lead whose phone number or e-mail already belongs to a contact. */
export function DuplicateSettingsScreen() {
  const canManage = useCan('admin.settings.manage');
  const qc = useQueryClient();
  const q = useLeadHandlingSettings(canManage);
  const [conflict, setConflict] = useState(false);
  return (
    <SettingsFrame
      canManage={canManage}
      loading={!q.data && !q.isError}
      error={q.isError ? q.error : null}
      onRetry={() => void q.refetch()}
      conflict={conflict}
      onConflictOk={() => setConflict(false)}
    >
      {q.data && (
        <Body
          key={q.data.duplicates.rowVersion ?? 'first'}
          settings={q.data.duplicates}
          onSaved={() => setConflict(false)}
          onConflict={() => {
            setConflict(true);
            void qc.invalidateQueries({ queryKey: LEAD_HANDLING_KEYS.settings });
          }}
        />
      )}
    </SettingsFrame>
  );
}

function Body({
  settings,
  onSaved,
  onConflict,
}: {
  settings: DuplicateSettings;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.settings');
  const td = useTranslations('contacts-attributes-tags.leadHandling.settings.duplicates');
  const { toast } = useToast();
  const qc = useQueryClient();
  const baseline = valuesOf(settings);
  const [form, setForm] = useState<DuplicateSettingsValues>(baseline);
  const [error, setError] = useState<unknown>(null);
  const dirty = !sameDuplicates(form, baseline);

  const saving = useRef(false);
  const save = useMutation({
    mutationFn: () =>
      leadHandlingApi.saveDuplicates({
        ...form,
        ...(settings.rowVersion === null ? {} : { rowVersion: settings.rowVersion }),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(LEAD_HANDLING_KEYS.settings, (old: LeadHandlingSettings | undefined) =>
        old ? { ...old, duplicates: saved } : old,
      );
      onSaved();
      toast(t('saved'), 'success');
    },
    onError: (e) => {
      if (isVersionConflict(e)) onConflict();
      else setError(e);
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const send = () => {
    if (saving.current) return;
    saving.current = true;
    setError(null);
    save.mutate();
  };

  return (
    <SettingsPage
      title={td('title')}
      subtitle={td('subtitle')}
      dirty={dirty}
      saving={save.isPending}
      onSave={send}
      onDiscard={() => setForm(baseline)}
      error={
        error !== null ? (
          <Alert tone="danger" role="alert">
            {t(`errors.${settingsErrorKey(error)}`)}
          </Alert>
        ) : null
      }
    >
      <SettingsSection title={td('mode.title')} intro={td('mode.intro')}>
        <RadioRow
          name="duplicate-mode"
          label={td('mode.merge')}
          hint={td('mode.mergeHint')}
          checked={form.mode === 'merge'}
          onChange={() => setForm((f) => ({ ...f, mode: 'merge' }))}
        />
        <RadioRow
          name="duplicate-mode"
          label={td('mode.createNew')}
          hint={td('mode.createNewHint')}
          checked={form.mode === 'create_new'}
          onChange={() => setForm((f) => ({ ...f, mode: 'create_new' }))}
        />
      </SettingsSection>
      <SettingsSection title={td('note.title')}>
        <ToggleRow
          label={td('note.merge')}
          checked={form.noteOnMerge}
          onChange={(v) => setForm((f) => ({ ...f, noteOnMerge: v }))}
        />
        <p className="pt-1 text-xs text-muted-foreground">{td('note.hint')}</p>
      </SettingsSection>
    </SettingsPage>
  );
}
