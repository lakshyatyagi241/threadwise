'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';

/** The FAQ accordion (WD-PLAN-009 / 011): plain-text answers, the first one open. Native <details>, so it works without script. */
export function FaqList({
  faqs,
}: {
  faqs: ReadonlyArray<{ id: string; question: string; answer: string }>;
}) {
  const t = useTranslations('plans-subscriptions-trials.plans.faq');
  const titleId = useId();
  if (faqs.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="space-y-3" data-testid="faq-list">
      <h2 id={titleId} className="text-lg font-semibold">
        {t('title')}
      </h2>
      <div className="divide-y divide-border rounded-xl border border-border">
        {faqs.map((f, i) => (
          <details key={f.id} open={i === 0} className="group px-4 py-3">
            <summary className="cursor-pointer list-none font-medium focus-visible:ring-2 focus-visible:ring-primary">
              {f.question}
            </summary>
            {/* Plain text on purpose: the answer is never interpreted as markup. */}
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{f.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
