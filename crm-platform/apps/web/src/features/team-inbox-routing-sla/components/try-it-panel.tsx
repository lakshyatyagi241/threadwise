'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  CHANNEL_KINDS,
  type ChannelKind,
  type RoutingTestResponse,
  type RoutingTestStep,
} from '@crm/contracts';
import { Alert, Badge, Button, Field, Select, Spinner, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ContactPicker } from '@/features/deals-pipelines/components/contact-picker';
import type { ContactRef } from '@/features/deals-pipelines/api/schemas';
import { routingApi } from '../api/routing';

type Hours = 'clock' | 'inside' | 'outside';

/**
 * "Try it": pick a contact, a channel and a sample message and see which step of the pipeline would decide, and why. It calls
 * `POST /inbox/routing/test`, which runs the engine's own decision in a read-only transaction: nothing is assigned, counted or sent.
 */
export function TryItPanel({ names }: { names: ReadonlyMap<string, string> }) {
  const t = useTranslations('team-inbox-routing-sla.assign.try');
  const tc = useTranslations('team-inbox-routing-sla.channels');
  const [contact, setContact] = useState<ContactRef | null>(null);
  const [channel, setChannel] = useState<ChannelKind>('whatsapp_cloud');
  const [message, setMessage] = useState('');
  const [hours, setHours] = useState<Hours>('clock');
  const run = useMutation({
    mutationFn: () =>
      routingApi.test({
        contactId: contact?.id ?? null,
        channelKind: channel,
        messageText: message,
        language: null,
        outsideHours: hours === 'clock' ? null : hours === 'outside',
      }),
  });

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-background p-4"
      data-testid="try-it"
      aria-labelledby="try-it-title"
    >
      <div>
        <h2 id="try-it-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('body')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('contact')} htmlFor="try-contact">
          <ContactPicker id="try-contact" value={contact} onChange={setContact} />
        </Field>
        <Field label={t('channel')} htmlFor="try-channel">
          <Select
            id="try-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelKind)}
          >
            {CHANNEL_KINDS.map((k) => (
              <option key={k} value={k}>
                {tc(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('message')} htmlFor="try-message">
          <Textarea
            id="try-message"
            rows={2}
            value={message}
            placeholder={t('messagePlaceholder')}
            maxLength={2000}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <Field label={t('part.businessHours')} htmlFor="try-hours">
          <Select
            id="try-hours"
            value={hours}
            onChange={(e) => setHours(e.target.value as Hours)}
          >
            <option value="clock">{t('clock')}</option>
            <option value="inside">{t('inside')}</option>
            <option value="outside">{t('outside')}</option>
          </Select>
        </Field>
      </div>
      {!contact && <p className="text-xs text-muted-foreground">{t('noContact')}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending && <Spinner />}
          {run.isPending ? t('running') : t('run')}
        </Button>
        {run.isError && (
          <span role="alert" className="text-sm text-danger">
            {run.error instanceof ApiError && run.error.message ? run.error.message : t('failed')}
          </span>
        )}
      </div>
      {run.data && <TryItResult res={run.data} names={names} />}
    </section>
  );
}

export function TryItResult({
  res,
  names,
}: {
  res: RoutingTestResponse;
  names: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('team-inbox-routing-sla.assign.try');
  const who = (() => {
    if (res.assigneeUserId)
      return t('who.agent', { name: names.get(res.assigneeUserId) ?? t('who.agentUnknown') });
    if (res.assigneeTeamId)
      return t('who.team', { name: names.get(res.assigneeTeamId) ?? t('who.teamUnknown') });
    return '';
  })();
  const headline =
    res.outcome === 'sticky'
      ? t('outcome.sticky', { who })
      : res.outcome === 'rule'
        ? t('outcome.rule', { rule: res.ruleName ?? '', who })
        : res.outcome === 'everyone_else'
          ? t('outcome.everyone', { who })
          : res.outcome === 'queue'
            ? t('outcome.queue')
            : t('outcome.off');
  const c = res.contact;
  const skipped = res.trace.filter((l) => l.result === 'skipped' && l.why);

  return (
    <div className="space-y-3" data-testid="try-it-result" role="status" aria-label={t('result')}>
      <Alert tone={res.outcome === 'queue' || res.outcome === 'off' ? 'warning' : 'success'}>
        <span data-testid="try-it-headline">{headline}</span>
      </Alert>
      {c.found && c.kind && (
        <p className="text-sm text-muted-foreground" data-testid="try-it-contact">
          {t('contactLine', {
            kind: t(`kind.${c.kind}`),
            stage: c.stage ?? '-',
            owner: c.hasOwner ? t('hasOwner') : t('noOwner'),
            tags: t('tags', { count: c.tagCount }),
          })}
        </p>
      )}
      <div>
        <h3 className="text-sm font-semibold">{t('stepsTitle')}</h3>
        <ol className="mt-2 space-y-2">
          {res.steps.map((s, i) => (
            <StepLine key={`${s.kind}-${s.ruleId ?? i}`} step={s} />
          ))}
        </ol>
      </div>
      {skipped.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">{t('skippedTitle')}</h3>
          <ul className="mt-1 list-disc ps-5 text-sm text-muted-foreground">
            {skipped.map((l, i) => (
              <li key={`${l.step}-${l.who ?? ''}-${i}`}>
                {l.who
                  ? (names.get(l.who) ?? t('who.agentUnknown'))
                  : l.step === 'owner' || l.step === 'last_handler'
                    ? t(`skipStep.${l.step}`)
                    : l.step}
                {': '}
                {SKIP_WHY.has(l.why ?? '') ? t(`skip.${l.why as 'on_leave'}`) : l.why}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const WHY_KEYS = new Set([
  'auto_assign_off',
  'sticky_off',
  'no_contact',
  'no_agent_found',
  'owner',
  'last_handler',
  'conditions_failed',
  'nobody_available',
  'agent_picked',
  'team_queue',
  'no_assignment_in_rule',
  'not_set',
]);
const SKIP_WHY = new Set([
  'on_leave',
  'offline_busy_or_at_capacity',
  'cannot_read',
  'no_owner',
  'no_previous_handler_in_window',
  'not_an_active_member',
]);
const PART_WHY = new Set([
  'no_saved_value',
  'no_contact',
  'not_same_kind',
  'channel_differs',
  'no_word',
  'language_differs',
  'hours_differ',
]);

function StepLine({ step }: { step: RoutingTestStep }) {
  const t = useTranslations('team-inbox-routing-sla.assign.try');
  const label =
    step.kind === 'rule'
      ? t('step.rule', { name: step.ruleName ?? '' })
      : step.kind === 'everyone_else'
        ? t('step.everyone')
        : t(`step.${step.kind}`);
  return (
    <li className="rounded-lg border border-border p-3 text-sm" data-testid={`try-step-${step.kind}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label}</span>
        <Badge tone={step.result === 'decided' ? 'success' : 'neutral'}>
          {WHY_KEYS.has(step.why) ? t(`why.${step.why as 'owner'}`) : step.why}
        </Badge>
      </p>
      {step.conditions.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {step.conditions.map((c) => (
            <li key={c.part}>
              {t(`part.${c.part}`)}:{' '}
              {c.matched
                ? t('partOk')
                : c.why && PART_WHY.has(c.why)
                  ? t(`partWhy.${c.why as 'no_word'}`)
                  : ''}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
