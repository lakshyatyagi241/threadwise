'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import type { FaqMatchDecision } from '@crm/contracts';
import { FAQ_LIMITS } from '@crm/contracts';
import { Badge, Button, Spinner, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { faqApi } from '../api/service';
import { pushHistory, verdictTone, verdictWithCheck } from '../lib/decision';
import { errorKey } from '../lib/errors';
import { DecisionView } from './decision-view';
import { useFaqFlow } from './faq-flow';
import { FaqIcon } from './icons';
import { CARD, LoadError, NoAccess, PageHeader } from './parts';

interface Run {
  query: string;
  decision: FaqMatchDecision;
}

/** The flow's Test tab: type what a customer might write and see, in numbers and words, what the bot would do. Nothing is sent or counted. */
export function PlaygroundScreen() {
  const t = useTranslations('faq.playground');
  const td = useTranslations('faq.decision');
  const { flowId, flowName } = useFaqFlow();
  const canRead = useCan('faq.entries.read');
  const [text, setText] = useState('');
  const [history, setHistory] = useState<Run[]>([]);
  const [current, setCurrent] = useState<Run | null>(null);
  const run = useMutation({
    mutationFn: (query: string) =>
      faqApi.test(flowId, query).then((decision): Run => ({ query, decision })),
    onSuccess: (r) => {
      setCurrent(r);
      setHistory((h) => pushHistory(h, r));
    },
  });

  if (!canRead) return <NoAccess permission="faq.entries.read" />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q !== '' && !run.isPending) run.mutate(q);
  };

  return (
    <section className="space-y-4">
      <PageHeader
        icon={<FaqIcon className="size-5" />}
        title={t('title')}
        subtitle={t('subtitle', { flow: flowName })}
      />

      <form onSubmit={submit} className={cn(CARD, 'space-y-3 p-4')}>
        <label htmlFor="faq-test-input" className="block text-sm font-medium">
          {t('label')}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="faq-test-input"
            value={text}
            maxLength={FAQ_LIMITS.queryMax}
            placeholder={t('placeholder')}
            onChange={(e) => setText(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button type="submit" variant="brand" disabled={text.trim() === '' || run.isPending}>
            {run.isPending && <Spinner />}
            {t('run')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </form>

      {run.isError && <LoadError errorKey={errorKey(run.error)} error={run.error} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          {current ? (
            <DecisionView decision={current.decision} query={current.query} />
          ) : (
            !run.isPending && (
              <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {t('empty')}
              </div>
            )
          )}
        </div>
        <aside aria-label={t('history.title')} className={cn(CARD, 'h-fit p-3')}>
          <h2 className="mb-2 text-sm font-semibold">{t('history.title')}</h2>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('history.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {history.map((h) => {
                const v = verdictWithCheck(h.decision);
                return (
                  <li key={h.query}>
                    <button
                      type="button"
                      onClick={() => {
                        setText(h.query);
                        setCurrent(h);
                      }}
                      className="flex w-full flex-col items-start gap-1 rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="line-clamp-2">{h.query}</span>
                      <Badge tone={verdictTone(v)}>{td(`verdict.${v}.title`)}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
