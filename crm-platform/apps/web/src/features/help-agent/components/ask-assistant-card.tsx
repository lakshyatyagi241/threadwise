'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import { useHelpAgent } from './assistant-root';

/**
 * The entry to the assistant in the Help center (`/help`): a card above the search. It renders nothing unless the assistant is on for
 * this person (plan, workspace switch and role), so the Help center never advertises what is off.
 */
export function AskAssistantCard() {
  const t = useTranslations('help-agent');
  const agent = useHelpAgent();
  if (!agent?.available) return null;
  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-wa-mint p-4"
      data-testid="ask-assistant-card"
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-wa-deep">{t('helpCard.title')}</h2>
        <p className="mt-0.5 text-[12.5px] text-wa-deep/80">{t('helpCard.body')}</p>
      </div>
      <Button onClick={() => agent.open()}>{t('helpCard.button')}</Button>
    </div>
  );
}
