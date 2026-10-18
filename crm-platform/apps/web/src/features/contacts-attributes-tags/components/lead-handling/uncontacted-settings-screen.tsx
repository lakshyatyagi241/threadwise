'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { UncontactedSettings, UncontactedSettingsValues } from '@crm/contracts';
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

/** The editable part of the section: every toggle, none of the bookkeeping. */
export function valuesOf(
  s: UncontactedSettings | UncontactedSettingsValues,
): UncontactedSettingsValues {
  return {
    clearOn: { ...s.clearOn },
    markNew: { ...s.markNew },
    onReassign: s.onReassign,
  };
}

export const sameUncontacted = (
  a: UncontactedSettingsValues,
  b: UncontactedSettingsValues,
): boolean => JSON.stringify(valuesOf(a)) === JSON.stringify(valuesOf(b));

/** `/uncontacted-leads`: which actions count as reaching a lead, which new contacts start uncontacted, and what a reassignment does. */
export function UncontactedSettingsScreen() {
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
          key={q.data.uncontacted.rowVersion ?? 'first'}
          settings={q.data.uncontacted}
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
  settings: UncontactedSettings;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.settings');
  const tu = useTranslations('contacts-attributes-tags.leadHandling.settings.uncontacted');
  const { toast } = useToast();
  const qc = useQueryClient();
  const baseline = valuesOf(settings);
  const [form, setForm] = useState<UncontactedSettingsValues>(baseline);
  const [error, setError] = useState<unknown>(null);
  const dirty = !sameUncontacted(form, baseline);

  const saving = useRef(false);
  const save = useMutation({
    mutationFn: () =>
      leadHandlingApi.saveUncontacted({
        ...form,
        ...(settings.rowVersion === null ? {} : { rowVersion: settings.rowVersion }),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(
        LEAD_HANDLING_KEYS.settings,
        (old: { uncontacted: UncontactedSettings } | undefined) => ({
          ...(old ?? {}),
          uncontacted: saved,
        }),
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

  const clear = (key: keyof UncontactedSettingsValues['clearOn']) => (v: boolean) =>
    setForm((f) => ({ ...f, clearOn: { ...f.clearOn, [key]: v } }));
  const mark = (key: keyof UncontactedSettingsValues['markNew']) => (v: boolean) =>
    setForm((f) => ({ ...f, markNew: { ...f.markNew, [key]: v } }));

  return (
    <SettingsPage
      title={tu('title')}
      subtitle={tu('subtitle')}
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
      <SettingsSection title={tu('clear.title')} intro={tu('clear.intro')}>
        <ToggleRow
          label={tu('clear.contactButton')}
          checked={form.clearOn.contactButton}
          onChange={clear('contactButton')}
        />
        <ToggleRow
          label={tu('clear.message')}
          checked={form.clearOn.message}
          onChange={clear('message')}
        />
        <ToggleRow
          label={tu('clear.automation')}
          checked={form.clearOn.automation}
          onChange={clear('automation')}
        />
        <ToggleRow
          label={tu('clear.activity')}
          checked={form.clearOn.activity}
          onChange={clear('activity')}
        />
        <p className="pt-1 text-xs text-muted-foreground">{tu('clear.manualHint')}</p>
      </SettingsSection>

      <SettingsSection title={tu('new.title')} intro={tu('new.intro')}>
        <ToggleRow
          label={tu('new.manual')}
          checked={form.markNew.manual}
          onChange={mark('manual')}
        />
        <ToggleRow
          label={tu('new.import')}
          checked={form.markNew.import}
          onChange={mark('import')}
        />
        <ToggleRow
          label={tu('new.leadSource')}
          checked={form.markNew.leadSource}
          onChange={mark('leadSource')}
        />
      </SettingsSection>

      <SettingsSection title={tu('reassign.title')} intro={tu('reassign.intro')}>
        <RadioRow
          name="uncontacted-reassign"
          label={tu('reassign.keep')}
          checked={form.onReassign === 'keep'}
          onChange={() => setForm((f) => ({ ...f, onReassign: 'keep' }))}
        />
        <RadioRow
          name="uncontacted-reassign"
          label={tu('reassign.mark')}
          checked={form.onReassign === 'mark'}
          onChange={() => setForm((f) => ({ ...f, onReassign: 'mark' }))}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
