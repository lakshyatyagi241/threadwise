'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Spinner, Switch, Tabs, useToast } from '@crm/ui';
import { RECORD_ASSIGNMENT_FEATURE } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { PlanPaywall } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import { RA_KEYS, assignmentApi, useAssignmentSettings } from '../api/assignment';
import { SUBJECTS } from '../lib/subjects';
import { SubjectPanel } from './subject-panel';
import { useRa } from './use-ra';

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} label={label} />
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

const isLocked = (e: unknown) => e instanceof ApiError && e.code === 'PLAN_FEATURE_LOCKED';

/**
 * `/record-assignment` (Settings > Automation > Record assignment rules): the workspace switch (OFF by default), then per module
 * (contacts, companies, deals) the priority-ordered rules, a test box and the run log. Reading needs `crm.assignment.read`, changing
 * `crm.assignment.manage`; a plan without the `record_assignment` feature gets the paywall. An owner someone set is never replaced.
 */
export function RecordAssignmentScreen() {
  const { t, rich } = useRa();
  const canManage = useCan('crm.assignment.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const pathname = usePathname();
  const settingsQ = useAssignmentSettings();
  const [busy, setBusy] = useState(false);
  const locked = isLocked(settingsQ.error);

  const save = async (patch: { enabled?: boolean; applyToImports?: boolean }, done?: string) => {
    setBusy(true);
    try {
      await assignmentApi.saveSettings(patch);
      if (done) toast(done);
    } catch {
      toast(t('toast.failed'), 'danger');
    } finally {
      await qc.invalidateQueries({ queryKey: RA_KEYS.settings });
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-6" data-testid="record-assignment">
      {locked && (
        <PlanPaywall
          gates={[{ href: pathname, feature: RECORD_ASSIGNMENT_FEATURE }]}
          enabled={[]}
        />
      )}
      <header className="space-y-2">
        <Link
          href="/settings/automation"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('back')}
        </Link>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <p className="text-sm text-muted-foreground" data-testid="ra-cross-note">
          {rich('crossNote', {
            link: (chunks) => (
              <Link href="/auto-assignment" className="underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </header>

      {!locked && (
        <>
          <div className="space-y-3 rounded-lg border border-border p-4" data-testid="ra-settings">
            {settingsQ.isPending ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> {t('list.loading')}
              </p>
            ) : settingsQ.isError ? (
              <Alert tone="danger">
                <p>{t('list.loadFailed')}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => void settingsQ.refetch()}
                >
                  {t('list.retry')}
                </Button>
              </Alert>
            ) : (
              <>
                <Toggle
                  label={t('master.title')}
                  hint={t('master.hint')}
                  checked={settingsQ.data.enabled}
                  disabled={!canManage || busy}
                  onChange={(v) => void save({ enabled: v }, t(v ? 'master.on' : 'master.off'))}
                />
                <Toggle
                  label={t('imports.title')}
                  hint={t('imports.hint')}
                  checked={settingsQ.data.applyToImports}
                  disabled={!canManage || busy}
                  onChange={(v) => void save({ applyToImports: v })}
                />
                {!canManage && (
                  <p className="text-xs text-muted-foreground">{t('list.readOnly')}</p>
                )}
              </>
            )}
          </div>

          <Alert tone="info">
            <p className="font-medium">{t('ownerRule.title')}</p>
            <p className="mt-1 text-sm">{t('ownerRule.body')}</p>
          </Alert>

          <Alert tone="info">
            <p className="mb-1 font-medium">{t('how.title')}</p>
            <ul className="list-disc space-y-0.5 ps-5 text-sm">
              {(['p1', 'p2', 'p3', 'p4', 'p5'] as const).map((k) => (
                <li key={k}>{t(`how.${k}`)}</li>
              ))}
            </ul>
          </Alert>

          <Tabs
            items={SUBJECTS.map((s) => ({
              id: s,
              label: t(`tabs.${s}`),
              content: <SubjectPanel subject={s} canManage={canManage} />,
            }))}
          />
        </>
      )}
    </section>
  );
}
