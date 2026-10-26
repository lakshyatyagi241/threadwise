'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

const ACTION =
  'inline-flex items-center justify-center rounded-md px-3 py-2 text-[13px] font-semibold transition';
const PRIMARY = `${ACTION} bg-brand text-brand-foreground hover:opacity-90`;
const SECONDARY = `${ACTION} border border-border hover:border-brand hover:text-brand`;

/** One way to start: a picture, what it is for, and the screens that begin it. A start the person may not use is shown as a note, not a dead link. */
function Start({
  id,
  tone,
  icon,
  title,
  body,
  children,
  locked,
}: {
  id: string;
  tone: string;
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
  locked: string | null;
}) {
  return (
    <section
      aria-labelledby={`studio-${id}`}
      data-testid={`studio-${id}`}
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-background p-5 shadow-sm"
    >
      <span
        aria-hidden
        className={cn('grid h-11 w-11 place-items-center rounded-xl text-foreground', tone)}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2 id={`studio-${id}`} className="text-[16px] font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {locked ? (
        <p
          role="note"
          className="mt-auto rounded-lg bg-muted p-2.5 text-[12.5px] text-muted-foreground"
        >
          {locked}
        </p>
      ) : (
        <div className="mt-auto flex flex-wrap gap-2">{children}</div>
      )}
    </section>
  );
}

const svg = (d: string, className = 'h-6 w-6') => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

/**
 * AI Studio: where a person starts building what talks to their customers. Three starts: an AI agent (answers from your own
 * knowledge), a chatbot (guided conversations with buttons, questions and cards, for WhatsApp or the website) and a workflow
 * (the advanced canvas for tags, webhooks, conditions and CRM steps). Every button leads to a screen that already exists.
 */
export function AiStudioScreen() {
  const t = useTranslations('aiStudio');
  const canAgents = useCan('aiag.training.create');
  const canFlows = useCan('flb.flows.create');
  const canWeb = useCan('wgt.widgets.read');
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-[13.5px] text-muted-foreground">{t('lead')}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        <Start
          id="agent"
          tone="bg-muted"
          icon={svg(
            'M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z',
          )}
          title={t('agent.title')}
          body={t('agent.body')}
          locked={canAgents ? null : t('noAccess')}
        >
          <Link href="/ai-training/create" className={PRIMARY}>
            {t('agent.create')}
          </Link>
          <Link href="/ai-training" className={SECONDARY}>
            {t('agent.open')}
          </Link>
        </Start>
        <Start
          id="chatbot"
          tone="bg-muted"
          icon={svg(
            'M21 14.5a3.5 3.5 0 0 1-3.5 3.5H8l-5 3V6.5A3.5 3.5 0 0 1 6.5 3h11A3.5 3.5 0 0 1 21 6.5z',
          )}
          title={t('chatbot.title')}
          body={t('chatbot.body')}
          locked={canFlows ? null : t('noAccess')}
        >
          {canWeb ? (
            <Link href="/flows/simple?type=web" className={PRIMARY}>
              {t('chatbot.web')}
              {svg(
                'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z',
                'ms-2 size-4',
              )}
            </Link>
          ) : null}
          <Link href="/flows/simple" className={canWeb ? SECONDARY : PRIMARY}>
            {t('chatbot.whatsapp')}
            {svg(
              'M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6L3 21zM9 10c.5 2 2.5 4 5 5l1.2-1.2-1.7-1-.8.7c-.8-.4-1.5-1.1-1.9-1.9l.7-.8-1-1.7L9 10z',
              'ms-2 size-4',
            )}
          </Link>
        </Start>
        <Start
          id="workflow"
          tone="bg-muted"
          icon={svg(
            'M5 5h4v4H5zM15 5h4v4h-4zM10 15h4v4h-4zM7 9v3a2 2 0 0 0 2 2h1M17 9v3a2 2 0 0 1-2 2h-1',
          )}
          title={t('workflow.title')}
          body={t('workflow.body')}
          locked={canFlows ? null : t('noAccess')}
        >
          <Link href="/flows/builder" className={PRIMARY}>
            {t('workflow.create')}
          </Link>
          <Link href="/flows" className={SECONDARY}>
            {t('workflow.open')}
          </Link>
        </Start>
      </div>
      <p className="text-[12.5px] text-muted-foreground">{t('deployNote')}</p>
    </div>
  );
}
