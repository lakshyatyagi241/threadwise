'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { guidebookVoteResponseSchema, type GuidebookVote } from '@crm/contracts';
import { cn } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';

const THUMB: Record<GuidebookVote, string> = {
  helpful:
    'M3 7.5h2.5V14H3zM5.5 13.5l1.5.5h4.5a1.5 1.5 0 0 0 1.5-1.5l.5-3.5a1.5 1.5 0 0 0-1.5-1.7H9V4a1.5 1.5 0 0 0-3 0c0 1.5-1.5 2.5-1.5 3.5',
  not_helpful:
    'M13 8.5h-2.5V2H13zM10.5 2.5l-1.5-.5H4.5A1.5 1.5 0 0 0 3 3.5l-.5 3.5A1.5 1.5 0 0 0 4 8.7H7V12a1.5 1.5 0 0 0 3 0c0-1.5 1.5-2.5 1.5-3.5',
};

/** "Was this helpful?" (WD-CMS-049). One vote per person: choosing again replaces it. */
export function VoteButtons({ slug, initial }: { slug: string; initial: GuidebookVote | null }) {
  const t = useTranslations('marketing-site-cms.guidebook');
  const [vote, setVote] = useState<GuidebookVote | null>(initial);
  const [thanks, setThanks] = useState<GuidebookVote | null>(null);
  const send = useMutation({
    mutationFn: (v: GuidebookVote) =>
      apiFetch(`/cms/guidebook/${encodeURIComponent(slug)}/vote`, {
        method: 'POST',
        body: { vote: v },
        schema: guidebookVoteResponseSchema,
      }),
    onSuccess: (r) => {
      setVote(r.vote);
      setThanks(r.vote);
    },
  });
  return (
    <section aria-label={t('helpful')} className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="text-muted-foreground">{t('helpful')}</span>
      {(['helpful', 'not_helpful'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={vote === v}
          disabled={send.isPending}
          onClick={() => send.mutate(v)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] hover:border-primary disabled:opacity-60',
            vote === v ? 'border-primary bg-primary/10 text-primary' : 'border-border',
          )}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <path d={THUMB[v]} />
          </svg>
          {t(v === 'helpful' ? 'yes' : 'no')}
        </button>
      ))}
      {thanks && (
        <span role="status" className="text-success">
          {t(thanks === 'helpful' ? 'thanksYes' : 'thanksNo')}
        </span>
      )}
      {send.isError && (
        <span role="alert" className="text-danger">
          {t('voteFailed')}
        </span>
      )}
    </section>
  );
}
