'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

/**
 * The two tabs of the Unofficial WhatsApp API area: the personal numbers and the warmer. The page is already behind the
 * `unofficial_whatsapp` gate; the Warmer tab also needs its own permission.
 */
export function UnofficialTabs({ active }: { active: 'numbers' | 'warmer' }) {
  const t = useTranslations('whatsapp-devices-baileys.area');
  const canWarm = useCan('sched.warmer.manage');
  const canNumbers = useCan('wa.devices.read');
  const tabs = [
    canNumbers ? { id: 'numbers', href: '/devices', label: t('numbers') } : null,
    canWarm ? { id: 'warmer', href: '/warmer', label: t('warmer') } : null,
  ].filter((x): x is { id: 'numbers' | 'warmer'; href: string; label: string } => x !== null);
  if (tabs.length < 2) return null;
  return (
    <div className="mx-auto max-w-[1300px] px-4 pt-4 sm:px-6">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('title')}
      </div>
      <nav aria-label={t('title')} className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={tab.id === active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              tab.id === active
                ? 'border-brand text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
