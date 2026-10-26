'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PLANS_PATH } from '../lib/format';

/**
 * The link that goes with every lock hint of an add-on feature ("Included in the Smart routing add-on or a higher plan."): it takes the
 * person to the workspace's plans and add-ons page, where the add-on is bought (or, for someone who cannot buy, the account owner can be
 * asked). One component so no locked control invents its own wording or target. Docs: packaging-teams-and-smart-routing.md.
 */
export function AddonLockLink({ className }: { className?: string }) {
  const t = useTranslations('plans-subscriptions-trials.lock');
  return (
    <Link
      href={PLANS_PATH}
      data-testid="addon-lock-link"
      className={className ?? 'font-medium text-primary underline underline-offset-2'}
    >
      {t('link')}
    </Link>
  );
}
