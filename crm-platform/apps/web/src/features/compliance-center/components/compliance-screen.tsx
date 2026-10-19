'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { ComplianceSettings } from '@crm/contracts';
import { Alert, Button, Spinner, Tabs, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useComplianceSettings } from '../api/hooks';
import { complianceApi } from '../api/service';
import { errorKey, isRowVersionConflict } from '../lib/errors';
import {
  formFromSettings,
  formProblems,
  settingsDirty,
  toSettingsInput,
  type SettingsForm,
} from '../lib/model';
import { ChecklistTab } from './checklist-tab';
import { ContactsTab } from './contacts-tab';
import { DncTab } from './dnc-tab';
import { LinksTab } from './links-tab';
import { NoticesTab } from './notices-tab';
import { PhiNotice } from './phi-notice';
import { ProfilesTab } from './profiles-tab';
import { SubprocessorsTab } from './subprocessors-tab';
import { WindowsTab } from './windows-tab';

export const TAB_IDS = [
  'checklist',
  'profiles',
  'contacts',
  'notices',
  'links',
  'subprocessors',
  'windows',
  'dnc',
] as const;
type TabId = (typeof TAB_IDS)[number];
const isTab = (v: string | null): v is TabId =>
  v !== null && (TAB_IDS as readonly string[]).includes(v);

/**
 * `/compliance`: the Compliance center (Settings, Security). Tools that help a workspace meet its privacy duties: the profiles of the
 * laws it works under, the officers a person can reach, the notices and links, the sub-processor list, the quiet hours, and a checklist
 * of what is in place. Nothing here makes a workspace compliant by itself, and nothing says it is.
 */
export function ComplianceScreen() {
  const t = useTranslations('compliance-center');
  const canRead = useCan('settings.compliance.read');
  const canManage = useCan('settings.compliance.manage');
  const qc = useQueryClient();
  const q = useComplianceSettings(canRead || canManage);
  const [conflict, setConflict] = useState(false);

  if (!canRead && !canManage) {
    return (
      <Alert tone="warning" role="alert">
        {t('errors.forbidden')}
      </Alert>
    );
  }
  if (q.isError) {
    return (
      <Alert tone="danger" role="alert" className="flex items-center justify-between gap-3">
        <span>{t(`errors.${errorKey(q.error)}`)}</span>
        <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
          {t('common.retry')}
        </Button>
      </Alert>
    );
  }
  if (!q.data) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }
  return (
    <>
      {conflict && (
        <Alert tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>{t('conflict')}</span>
          <Button size="sm" variant="secondary" onClick={() => setConflict(false)}>
            {t('conflictOk')}
          </Button>
        </Alert>
      )}
      <Body
        key={q.data.rowVersion ?? 'first'}
        settings={q.data}
        canManage={canManage}
        onSaved={() => setConflict(false)}
        onConflict={() => {
          setConflict(true);
          void qc.invalidateQueries({ queryKey: KEYS.settings });
        }}
      />
    </>
  );
}

function Body({
  settings,
  canManage,
  onSaved,
  onConflict,
}: {
  settings: ComplianceSettings;
  canManage: boolean;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const t = useTranslations('compliance-center');
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const baseline = formFromSettings(settings);
  const [form, setForm] = useState<SettingsForm>(baseline);
  const [error, setError] = useState<unknown>(null);
  const dirty = settingsDirty(form, baseline);
  const problems = formProblems(form);
  const tabParam = params.get('tab');
  const tab: TabId = isTab(tabParam) ? tabParam : 'checklist';

  const setTab = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const saving = useRef(false);
  const save = useMutation({
    mutationFn: () => complianceApi.saveSettings(toSettingsInput(form, settings.rowVersion)),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      void qc.invalidateQueries({ queryKey: KEYS.checklist });
      void qc.invalidateQueries({ queryKey: KEYS.links });
      onSaved();
      toast(t('saved'), 'success');
    },
    onError: (e) => {
      if (isRowVersionConflict(e)) onConflict();
      else setError(e);
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const send = () => {
    if (saving.current || problems.length > 0) return;
    saving.current = true;
    setError(null);
    save.mutate();
  };
  const patch = (p: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...p }));

  const items = [
    { id: 'checklist', label: t('tabs.checklist'), content: <ChecklistTab onOpenTab={setTab} /> },
    {
      id: 'profiles',
      label: t('tabs.profiles'),
      content: (
        <ProfilesTab
          settings={settings}
          form={form}
          patch={patch}
          problems={problems}
          canManage={canManage}
        />
      ),
    },
    {
      id: 'contacts',
      label: t('tabs.contacts'),
      content: <ContactsTab form={form} patch={patch} problems={problems} canManage={canManage} />,
    },
    {
      id: 'notices',
      label: t('tabs.notices'),
      content: <NoticesTab settings={settings} form={form} patch={patch} canManage={canManage} />,
    },
    {
      id: 'links',
      label: t('tabs.links'),
      content: <LinksTab form={form} patch={patch} problems={problems} canManage={canManage} />,
    },
    {
      id: 'subprocessors',
      label: t('tabs.subprocessors'),
      content: (
        <SubprocessorsTab settings={settings} form={form} patch={patch} canManage={canManage} />
      ),
    },
    {
      id: 'windows',
      label: t('tabs.windows'),
      content: (
        <WindowsTab
          form={form}
          patch={patch}
          problems={problems}
          canManage={canManage}
          workspaceTimezone={settings.workspaceTimezone}
        />
      ),
    },
    { id: 'dnc', label: t('tabs.dnc'), content: <DncTab canManage={canManage} /> },
  ];

  return (
    <div className="space-y-4" data-testid="compliance-center">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <PhiNotice />
      {!canManage && <Alert>{t('readOnly')}</Alert>}
      <Tabs items={items} value={tab} onValueChange={setTab} />
      {error !== null && <Alert tone="danger">{t(`errors.${errorKey(error)}`)}</Alert>}
      {canManage && dirty && (
        <div
          className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 shadow"
          data-testid="save-bar"
        >
          <span className="text-sm text-muted-foreground">
            {problems.length > 0 ? t('saveBar.problems') : t('saveBar.unsaved')}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setForm(baseline)}>
              {t('saveBar.discard')}
            </Button>
            <Button
              onClick={send}
              disabled={problems.length > 0 || save.isPending}
              data-testid="save-settings"
            >
              {save.isPending && <Spinner />}
              {t('saveBar.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
