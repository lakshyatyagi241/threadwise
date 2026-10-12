'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

/**
 * The tabs of the Unofficial WhatsApp API area: the personal numbers, their groups and the warmer. The page is already behind the
 * `unofficial_whatsapp` gate; the Groups and Warmer tabs also need their own permission.
 */
type TabId = 'numbers' | 'groups' | 'warmer';

export function UnofficialTabs({ active }: { active: TabId }) {
  const t = useTranslations('whatsapp-devices-baileys.area');
  const canWarm = useCan('sched.warmer.manage');
  const canNumbers = useCan('wa.devices.read');
  const canGroups = useCan('wa.groups.read');
  const tabs = [
    canNumbers ? { id: 'numbers', href: '/devices', label: t('numbers') } : null,
    canGroups ? { id: 'groups', href: '/devices/groups', label: t('groups') } : null,
    canWarm ? { id: 'warmer', href: '/warmer', label: t('warmer') } : null,
  ].filter((x): x is { id: TabId; href: string; label: string } => x !== null);
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
