'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ToastProvider, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

const LIST_PATHS = ['/privacy-requests', '/privacy-requests/legal-holds'];

/** Data requests and Legal holds are two registers of the same Settings > Privacy area; shown on the two list screens only. */
function PrivacyTabs() {
  const t = useTranslations('privacy-requests.legalHold.tab');
  const pathname = usePathname();
  const canRead = useCan('privacy.requests.read');
  if (!canRead || !LIST_PATHS.includes(pathname)) return null;
  const tabs = [
    { href: '/privacy-requests', label: t('requests') },
    { href: '/privacy-requests/legal-holds', label: t('holds') },
  ];
  return (
    <nav aria-label={t('label')} className="flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            pathname === tab.href
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** One frame for the /privacy-requests screens: the toasts. */
export function PrivacyShell({ children }: { children: ReactNode }) {
  const t = useTranslations('privacy-requests.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <div className="space-y-4">
        <PrivacyTabs />
        {children}
      </div>
    </ToastProvider>
  );
}
