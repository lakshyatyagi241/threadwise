'use client';

import { useTranslations } from 'next-intl';
import { Button, useToast } from '@crm/ui';
import type { MessageSystemEvent } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useUndoStageChange } from '../api/stage-undo';

type StageEvent = Extract<MessageSystemEvent, { event: 'stage_change' }>;

/**
 * The system line that tells the thread the AI moved the contact to another stage after reading the chat, with an Undo while nobody
 * has put it back (`undone`: a later "undone" line of the same suggestion is in the thread). A refused undo (the contact moved on, or
 * it was already undone elsewhere) says so; the line stays as the record.
 */
export function StageChangeLine({ event, undone }: { event: StageEvent; undone: boolean }) {
  const t = useTranslations('team-inbox-conversations.bubble.stageLine');
  const { toast } = useToast();
  const canReview = useCan('lsc.stage.review');
  const undo = useUndoStageChange();

  const run = () =>
    undo.mutate(event.suggestionId, {
      onSuccess: () => toast(t('undoneToast', { stage: event.fromStage })),
      onError: () => toast(t('couldNotUndo'), 'danger'),
    });

  if (event.action === 'undone') {
    return (
      <p
        data-testid="inbox-stage-line"
        className="max-w-[80%] rounded-md bg-muted px-3 py-1 text-center text-xs text-muted-foreground"
      >
        {t('undone', { stage: event.toStage })}
      </p>
    );
  }
  return (
    <p
      data-testid="inbox-stage-line"
      className="flex max-w-[80%] flex-wrap items-center justify-center gap-x-2 rounded-md bg-muted px-3 py-1 text-center text-xs text-muted-foreground"
    >
      <span>{t('auto', { from: event.fromStage, to: event.toStage })}</span>
      {undone ? (
        <span className="font-medium">{t('wasUndone')}</span>
      ) : canReview ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto p-0 text-xs"
          disabled={undo.isPending}
          onClick={run}
          data-testid="inbox-stage-undo"
        >
          {t('undo')}
        </Button>
      ) : null}
    </p>
  );
}
