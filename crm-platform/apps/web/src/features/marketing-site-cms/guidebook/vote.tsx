'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { guidebookVoteResponseSchema, type GuidebookVote } from '@crm/contracts';
import { Alert, Button } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';

/** "Was this helpful?" (TW-CMS-049). One vote per person: choosing again replaces it. */
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
    <section aria-label={t('helpful')} className="space-y-2 border-t border-border pt-4">
      <p className="text-sm font-medium">{t('helpful')}</p>
      <div className="flex gap-2">
        {(['helpful', 'not_helpful'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={vote === v ? 'primary' : 'secondary'}
            aria-pressed={vote === v}
            disabled={send.isPending}
            onClick={() => send.mutate(v)}
          >
            {t(v === 'helpful' ? 'yes' : 'no')}
          </Button>
        ))}
      </div>
      {thanks && (
        <Alert tone="success" role="status">
          {t(thanks === 'helpful' ? 'thanksYes' : 'thanksNo')}
        </Alert>
      )}
      {send.isError && <Alert tone="danger">{t('voteFailed')}</Alert>}
    </section>
  );
}
