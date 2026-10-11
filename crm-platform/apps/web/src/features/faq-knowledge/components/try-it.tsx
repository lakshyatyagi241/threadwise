'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FAQ_LIMITS } from '@crm/contracts';
import { Button, Spinner } from '@crm/ui';
import { faqApi } from '../api/service';
import { errorKey } from '../lib/errors';
import { DecisionView } from './decision-view';
import { LoadError, SectionCard } from './parts';

/** "Try it" in the editor: what would the bot do with this message right now? Saved FAQs only (unsaved edits are not matched). */
export function TryIt() {
  const t = useTranslations('faq.tryIt');
  const [text, setText] = useState('');
  const run = useMutation({ mutationFn: (q: string) => faqApi.test(q).then((d) => ({ q, d })) });
  const submit = () => {
    const q = text.trim();
    if (q && !run.isPending) run.mutate(q);
  };
  return (
    <SectionCard id="faq-tryit" title={t('title')} hint={t('hint')}>
      {/* Not a <form>: the editor shows this inside its own form, and forms cannot nest (Enter here runs the test). */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('title')}>
        <label htmlFor="faq-tryit-input" className="sr-only">
          {t('label')}
        </label>
        <input
          id="faq-tryit-input"
          value={text}
          maxLength={FAQ_LIMITS.queryMax}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t('placeholder')}
          className="h-10 min-w-40 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={text.trim() === '' || run.isPending}
          onClick={submit}
        >
          {run.isPending && <Spinner />}
          {t('run')}
        </Button>
      </div>
      {run.isError && <LoadError errorKey={errorKey(run.error)} error={run.error} />}
      {run.data && <DecisionView decision={run.data.d} query={run.data.q} compact />}
    </SectionCard>
  );
}
