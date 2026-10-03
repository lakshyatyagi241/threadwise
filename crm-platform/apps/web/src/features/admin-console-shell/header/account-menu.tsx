'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { OperatorSessionResponse } from '@crm/contracts';
import { Menu, MenuItem, MenuSeparator } from '@crm/ui';
import { OPERATOR_ACCOUNT_PATH } from '@/features/auth-registration-security/platform/operator-nav';
import { initials } from './header-logic';

const Caret = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 12 12"
    className="size-3 text-muted-foreground"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M3 5l3 3 3-3" />
  </svg>
);

/**
 * WD-ASHELL-006: the avatar button (initials, name, role) and its menu: email, My account, Settings, Admin overview and
 * Sign out. WaDesk's account and settings links lead to the customer pages; an operator has no customer session, so they
 * lead to the operator's own account page and the platform settings.
 */
export function AccountMenu({
  operator,
  onSignOut,
  disabled,
}: {
  operator: OperatorSessionResponse['operator'];
  onSignOut: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('admin-console-shell.header.account');
  const tr = useTranslations('auth-registration-security.platform.shell.roles');
  const router = useRouter();
  const name = operator.fullName || operator.email.split('@')[0] || '';
  return (
    <Menu
      label={t('menu')}
      align="end"
      disabled={disabled}
      className="w-60"
      triggerClassName="h-auto gap-2 rounded-full border-transparent bg-transparent py-1 ps-1 pe-2.5"
      triggerProps={{ 'aria-label': t('open', { name }) }}
      trigger={
        <>
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {initials(operator.fullName, operator.email)}
          </span>
          <span className="hidden text-start md:block">
            <span className="block max-w-36 truncate text-[13px] font-semibold leading-tight">
              {name}
            </span>
            <span className="block text-[11px] font-normal leading-tight text-muted-foreground">
              {tr(operator.role)}
            </span>
          </span>
          <Caret />
        </>
      }
    >
      <div
        role="presentation"
        title={operator.email}
        className="truncate px-2.5 py-1.5 text-xs text-muted-foreground"
      >
        {operator.email}
      </div>
      <MenuItem onSelect={() => router.push(OPERATOR_ACCOUNT_PATH)}>{t('myAccount')}</MenuItem>
      <MenuItem onSelect={() => router.push('/admin/settings')}>{t('settings')}</MenuItem>
      <MenuItem onSelect={() => router.push('/admin')}>{t('overview')}</MenuItem>
      <MenuSeparator />
      <MenuItem danger onSelect={onSignOut}>
        {t('signOut')}
      </MenuItem>
    </Menu>
  );
}
