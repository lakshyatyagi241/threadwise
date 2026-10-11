'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, ToastProvider, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFaqSummary } from '../api/hooks';
import { StateBanner } from './state-banner';

interface Tab {
  id: 'faqs' | 'test' | 'unanswered' | 'insights' | 'settings';
  href: string;
  needs: string;
}

const TABS: readonly Tab[] = [
  { id: 'faqs', href: '/faq', needs: 'faq.entries.read' },
  { id: 'test', href: '/faq/test', needs: 'faq.entries.read' },
  { id: 'unanswered', href: '/faq/unanswered', needs: 'faq.insights.read' },
  { id: 'insights', href: '/faq/insights', needs: 'faq.insights.read' },
  { id: 'settings', href: '/faq/settings', needs: 'faq.entries.read' },
];

/** The tab a path belongs to: `/faq/new` and `/faq/<id>` are the FAQs tab. */
export function activeTab(pathname: string): Tab['id'] {
  const rest = pathname.replace(/\/+$/, '').split('/')[2];
  return rest === 'test' || rest === 'unanswered' || rest === 'insights' || rest === 'settings'
    ? rest
    : 'faqs';
}

/** One frame for every /faq screen: toasts, the sub-navigation with the Unanswered count, and the state banner. */
export function FaqShell({ children }: { children: ReactNode }) {
  const t = useTranslations('faq.nav');
  const tc = useTranslations('faq.common');
  const pathname = usePathname();
  const canInsights = useCan('faq.insights.read');
  const canRead = useCan('faq.entries.read');
  const summary = useFaqSummary(30, canInsights);
  const unanswered = summary.data?.unresolvedUnanswered ?? 0;
  const current = activeTab(pathname);
  const allowed = {
    'faq.entries.read': canRead,
    'faq.insights.read': canInsights,
  } as Record<string, boolean>;

  return (
    <ToastProvider dismissLabel={tc('dismiss')}>
      <div className="space-y-4">
        <nav aria-label={t('label')} className="-mx-1 overflow-x-auto">
          <ul className="flex min-w-max gap-1 border-b border-border px-1">
            {TABS.filter((tab) => allowed[tab.needs]).map((tab) => (
              <li key={tab.id}>
                <Link
                  href={tab.href}
                  aria-current={current === tab.id ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition',
                    'focus-visible:ring-2 focus-visible:ring-primary',
                    current === tab.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`tab.${tab.id}`)}
                  {tab.id === 'unanswered' && unanswered > 0 && (
                    <Badge tone="warning" aria-label={t('unansweredCount', { count: unanswered })}>
                      {unanswered > 99 ? '99+' : unanswered}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {current !== 'settings' && <StateBanner />}
        {children}
      </div>
    </ToastProvider>
  );
}
