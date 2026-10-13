'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Field, Spinner, Textarea } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useRecommend } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { LoadError, SectionCard, useFormatHour, useFormatNumber } from './parts';

const MIN_GOAL = 5;
const MAX_GOAL = 500;

/**
 * The broadcast assistant: say what you want to achieve and it suggests one of your audiences and one of your approved templates,
 * weighing the replies each template really got. It only suggests: nothing is created or sent.
 */
export function AssistantTab() {
  const t = useTranslations('growth.assistant');
  const hour = useFormatHour();
  const num = useFormatNumber();
  const canRun = useCan('lsc.contacts.score');
  const [goal, setGoal] = useState('');
  const ask = useRecommend();
  const valid = goal.trim().length >= MIN_GOAL && goal.trim().length <= MAX_GOAL;

  return (
    <SectionCard id="growth-assistant" title={t('title')} hint={t('hint')}>
      <Field label={t('goal')} htmlFor="growth-goal" hint={t('goalHint')}>
        <Textarea
          id="growth-goal"
          rows={3}
          value={goal}
          maxLength={MAX_GOAL}
          placeholder={t('placeholder')}
          onChange={(e) => setGoal(e.target.value)}
        />
      </Field>
      <div>
        <Button
          variant="brand"
          disabled={!canRun || !valid || ask.isPending}
          onClick={() => ask.mutate({ goal: goal.trim() })}
        >
          {ask.isPending && <Spinner />}
          {t('ask')}
        </Button>
      </div>
      {ask.isError && <LoadError errorKey={errorKey(ask.error)} error={ask.error} />}
      {ask.isSuccess && (
        <Alert tone="info" className="space-y-2">
          <p className="font-medium">{ask.data.subject}</p>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t('audience')}</dt>
            <dd>
              {t('audienceValue', {
                name: ask.data.audience.name,
                count: num.count(ask.data.audience.size),
              })}
            </dd>
            <dt className="text-muted-foreground">{t('template')}</dt>
            <dd>
              {ask.data.template.name}
              {ask.data.template.replyRate24h !== null &&
                ` (${t('replyRate', { percent: num.percent(ask.data.template.replyRate24h) })})`}
            </dd>
            {ask.data.sendHour !== null && (
              <>
                <dt className="text-muted-foreground">{t('sendAt')}</dt>
                <dd>{hour(ask.data.sendHour)}</dd>
              </>
            )}
          </dl>
          {ask.data.reasons.length > 0 && (
            <ul className="list-disc ps-5 text-sm">
              {ask.data.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {t('considered', {
              audiences: ask.data.considered.audiences,
              templates: ask.data.considered.templates,
            })}
          </p>
        </Alert>
      )}
    </SectionCard>
  );
}
