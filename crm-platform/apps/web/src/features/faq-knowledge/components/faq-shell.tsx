'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFaqSummary } from '../api/hooks';
import { faqTabOf, type FaqLocation, type FaqTabId, type FaqView } from '../lib/links';
import { useFaqFlow } from './faq-flow';
import { StateBanner } from './state-banner';

interface Tab {
  id: FaqTabId;
  view: FaqView;
  needs: string;
}

const TABS: readonly Tab[] = [
  { id: 'faqs', view: 'list', needs: 'faq.entries.read' },
  { id: 'test', view: 'test', needs: 'faq.entries.read' },
  { id: 'unanswered', view: 'unanswered', needs: 'faq.insights.read' },
  { id: 'insights', view: 'insights', needs: 'faq.insights.read' },
  { id: 'settings', view: 'settings', needs: 'faq.entries.read' },
];

/**
 * The frame of a flow's FAQs tab: the strip of its screens (FAQs, Test, Unanswered, Insights, Settings, with the Unanswered
 * count of this flow) and the state banner. Each screen is a link to `?tab=faqs&view=...`, so back, forward and reload work.
 */
export function FaqShell({ location, children }: { location: FaqLocation; children: ReactNode }) {
  const t = useTranslations('faq.nav');
  const { href } = useFaqFlow();
  const canInsights = useCan('faq.insights.read');
  const canRead = useCan('faq.entries.read');
  const summary = useFaqSummary(30, canInsights);
  const unanswered = summary.data?.unresolvedUnanswered ?? 0;
  const current = faqTabOf(location);
  const allowed = {
    'faq.entries.read': canRead,
    'faq.insights.read': canInsights,
  } as Record<string, boolean>;

  return (
    <div className="space-y-4">
      <nav aria-label={t('label')} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-border px-1">
          {TABS.filter((tab) => allowed[tab.needs]).map((tab) => (
            <li key={tab.id}>
              <Link
                href={href(tab.view)}
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
  );
}
