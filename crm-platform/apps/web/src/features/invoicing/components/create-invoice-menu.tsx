'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu, MenuItem } from '@crm/ui';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';
import { usePlanFeature } from '@/lib/plan-features';
import { PlusIcon, RefreshIcon } from './icons';

/**
 * "Create" on the Invoices page: one menu that asks what kind of invoice, as the big CRMs do: a one-time invoice, or recurring invoices.
 * Recurring invoices are a plan feature (`recurring_invoices`): a plan without it sees the item, switched off, with the reason and the way
 * to the plans page, instead of an item that opens a screen which then refuses. A person without the permission does not see the item.
 */
export function CreateInvoiceMenu({
  canCreate,
  canCreateRecurring,
}: {
  canCreate: boolean;
  canCreateRecurring: boolean;
}) {
  const t = useTranslations('invoicing.list');
  const router = useRouter();
  const recurringInPlan = usePlanFeature('recurring_invoices');
  if (!canCreate && !canCreateRecurring) return null;
  return (
    <Menu
      label={t('createMenu')}
      align="end"
      triggerClassName="h-10 gap-2 border-transparent bg-brand px-5 text-sm font-medium text-brand-foreground hover:opacity-90"
      trigger={
        <>
          <PlusIcon /> {t('create')}
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true" fill="currentColor">
            <path d="M2 4l4 4 4-4z" />
          </svg>
        </>
      }
    >
      {canCreate && (
        <MenuItem onSelect={() => router.push('/invoices/new')}>
          <PlusIcon /> {t('createOneTime')}
        </MenuItem>
      )}
      {canCreateRecurring && (
        <MenuItem
          disabled={!recurringInPlan}
          hint={recurringInPlan ? undefined : t('notInPlan')}
          onSelect={() => router.push('/recurring-invoices/new')}
        >
          <RefreshIcon /> {t('createRecurring')}
        </MenuItem>
      )}
      {canCreateRecurring && !recurringInPlan && (
        <Link
          href={PLAN_UPGRADE_PATH}
          role="menuitem"
          tabIndex={-1}
          className="block px-3 py-2 text-xs font-medium text-primary hover:underline"
        >
          {t('seePlans')}
        </Link>
      )}
    </Menu>
  );
}
