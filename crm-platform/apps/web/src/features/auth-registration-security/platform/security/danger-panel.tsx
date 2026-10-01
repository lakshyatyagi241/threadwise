'use client';

import { useTranslations } from 'next-intl';
import type { SecurityOverviewResponse } from '@crm/contracts';
import { Alert, Badge, cn } from '@crm/ui';
import type { DangerKind } from '../lib/danger';
import { useOperator } from '../operator-context';
import { SettingsCard } from './controls';
import { SECURITY_NS } from './policy-form';

/** The platform-wide send halt, impossible to miss: shown above the tabs whenever it is engaged. */
export function HaltBanner({ onResume }: { onResume: () => void }) {
  const t = useTranslations(`${SECURITY_NS}.danger.halted`);
  const { canRunDanger } = useOperator();
  return (
    <Alert
      tone="danger"
      className="flex flex-wrap items-center justify-between gap-3 border-2 py-3"
    >
      <div className="min-w-0">
        <p className="text-base font-semibold">{t('title')}</p>
        <p className="text-sm">{t('body')}</p>
      </div>
      {canRunDanger && (
        <button
          type="button"
          onClick={onResume}
          className="shrink-0 rounded-md bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-foreground"
        >
          {t('resume')}
        </button>
      )}
    </Alert>
  );
}

function ActionRow({
  title,
  detail,
  onClick,
  disabled,
  tone = 'danger',
}: {
  title: string;
  detail: string;
  onClick: () => void;
  disabled: boolean;
  tone?: 'danger' | 'success';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-3 text-start text-sm font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary',
        tone === 'danger'
          ? 'border-danger/40 bg-background hover:bg-danger/10'
          : 'border-success/40 bg-success/10 text-success hover:bg-success/15',
      )}
    >
      <span>{title}</span>
      <span
        className={cn('font-mono text-[11px] font-normal', tone === 'danger' ? 'text-danger' : '')}
      >
        {detail}
      </span>
    </button>
  );
}

export function DangerPanel({
  overview,
  onAction,
}: {
  overview: SecurityOverviewResponse;
  onAction: (kind: DangerKind) => void;
}) {
  const t = useTranslations(`${SECURITY_NS}.danger`);
  const tRole = useTranslations('auth-registration-security.platform.shell.roles');
  const { canRunDanger, operator } = useOperator();
  const halted = overview.emergencyHalt;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <SettingsCard
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        tone="danger"
      >
        {!canRunDanger && (
          <Alert tone="warning">{t('superAdminOnly', { role: tRole(operator.role) })}</Alert>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('haltState')}</span>
          <Badge tone={halted ? 'danger' : 'success'}>{halted ? t('haltOn') : t('haltOff')}</Badge>
        </div>
        <div className="space-y-3">
          <ActionRow
            title={t('revoke.title')}
            detail={t('revoke.detail')}
            disabled={!canRunDanger}
            onClick={() => onAction('revoke_sessions')}
          />
          <ActionRow
            title={t('forceReset.title')}
            detail={t('forceReset.detail')}
            disabled={!canRunDanger}
            onClick={() => onAction('force_password_reset')}
          />
          <div className="space-y-1.5">
            <ActionRow
              title={t('rotate.title')}
              detail={t('rotate.detail')}
              disabled={!canRunDanger}
              onClick={() => onAction('rotate_webhook_secrets')}
            />
            <p className="px-1 text-xs text-muted-foreground">{t('rotate.note')}</p>
          </div>
          {halted ? (
            <ActionRow
              title={t('resume.title')}
              detail={t('resume.detail')}
              disabled={!canRunDanger}
              tone="success"
              onClick={() => onAction('resume_sends')}
            />
          ) : (
            <ActionRow
              title={t('halt.title')}
              detail={t('halt.detail')}
              disabled={!canRunDanger}
              onClick={() => onAction('halt_sends')}
            />
          )}
        </div>
      </SettingsCard>

      <SettingsCard kicker={t('logged.kicker')} title={t('logged.title')}>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {(['revoke', 'forceReset', 'rotate', 'halt', 'policy'] as const).map((k) => (
            <li key={k}>
              <code className="font-mono text-xs text-foreground" dir="ltr">
                {t(`logged.events.${k}`)}
              </code>
              <span className="block">{t(`logged.notes.${k}`)}</span>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
}
