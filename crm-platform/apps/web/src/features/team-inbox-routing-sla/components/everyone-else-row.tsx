'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { RoutingRule, RoutingStrategy } from '@crm/contracts';
import { Badge, ConfirmDialog, Select, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { refresh, routingApi, updateRuleFresh } from '../api/routing';
import { everyoneElseMode, type EveryoneElseMode } from '../lib/pipeline';
import { namesSummary } from '../lib/summary';

const EVENLY = (strategy: RoutingStrategy) => ({
  strategy,
  userIds: [],
  teamIds: [],
  everyone: true,
});

/**
 * Creates the "Everyone else: distribute evenly" row, or switches an existing one to it. Used by the row's own choice and by the Auto
 * Assignment switch (only when an admin turns it on and no such row exists). Never called at deploy time (spec H19).
 */
export async function ensureEveryoneElseEvenly(
  rule: RoutingRule | undefined,
  name: string,
  strategy: RoutingStrategy = 'round_robin',
): Promise<void> {
  if (rule) {
    await updateRuleFresh(rule, { assign: EVENLY(strategy), isActive: true });
    return;
  }
  await routingApi.create({
    name,
    isFallback: true,
    appliesToAll: true,
    assign: EVENLY(strategy),
    isActive: true,
  });
}

/**
 * "Everyone else", pinned last in the list (the one fallback rule): who gets a chat that no rule took. Three choices: distribute evenly among
 * all agents, the people or teams the admin picked (the rule's own editor), or leave it in the waiting queue (the row is switched off, or
 * never existed). No conditions here: it takes whatever is left.
 */
export function EveryoneElseRow({
  rule,
  names,
  canManage,
}: {
  rule: RoutingRule | undefined;
  names: ReadonlyMap<string, string>;
  canManage: boolean;
}) {
  const t = useTranslations('team-inbox-routing-sla.assign.everyone');
  const ts = useTranslations('team-inbox-routing-sla.rules.strategy');
  const tp = useTranslations('team-inbox-routing-sla.page');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmEvenly, setConfirmEvenly] = useState(false);
  const mode = everyoneElseMode(rule);
  const strategy: RoutingStrategy =
    rule?.assign && rule.assign.strategy !== 'specific' ? rule.assign.strategy : 'round_robin';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh(qc);
      toast(t('saved'));
    } catch (e) {
      toast(e instanceof ApiError && e.message ? e.message : t('failed'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  const evenly = (s: RoutingStrategy = strategy) =>
    run(() => ensureEveryoneElseEvenly(rule, t('ruleName'), s));
  const queue = () => run(async () => (rule ? updateRuleFresh(rule, { isActive: false }) : null));
  const pick = (m: EveryoneElseMode) => {
    if (m === 'evenly') {
      if (mode === 'listed') setConfirmEvenly(true);
      else void evenly();
    } else if (m === 'queue') void queue();
    else router.push(rule ? `/auto-assignment/${rule.id}` : '/auto-assignment/new?everyoneElse=1');
  };

  const who = (() => {
    if (!rule?.assign || rule.assign.everyone) return '';
    const people = [...rule.assign.userIds, ...rule.assign.teamIds].map(
      (id) => names.get(id) ?? '…',
    );
    const { shown, more } = namesSummary(people);
    return more > 0 ? `${shown.join(', ')} +${more}` : shown.join(', ');
  })();

  const option = (m: EveryoneElseMode, label: string, hint: string) => (
    <label
      key={m}
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
        mode === m ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <input
        type="radio"
        name="everyone-else"
        data-testid={`everyone-${m}`}
        className="mt-1"
        checked={mode === m}
        disabled={!canManage || busy}
        onChange={() => pick(m)}
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        {m === 'evenly' && mode === 'evenly' && (
          <Select
            aria-label={t('strategy')}
            className="mt-2 max-w-xs"
            value={strategy}
            disabled={!canManage || busy}
            onChange={(e) => void evenly(e.target.value as RoutingStrategy)}
          >
            <option value="round_robin">{ts('round_robin')}</option>
            <option value="least_busy">{ts('least_busy')}</option>
          </Select>
        )}
        {m === 'listed' && mode === 'listed' && rule && (
          <span className="mt-1 block text-xs">
            {t('listedNow', { who })}{' '}
            {canManage && (
              <Link
                href={`/auto-assignment/${rule.id}`}
                className="font-medium text-primary hover:underline"
              >
                {t('listedEdit')}
              </Link>
            )}
          </span>
        )}
      </span>
    </label>
  );

  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-background p-4"
      data-testid="everyone-else"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{t('title')}</h3>
        <Badge tone="neutral">{t('pinned')}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t('body')}</p>
      {!rule && <p className="text-xs text-warning">{t('notSet')}</p>}
      <fieldset className="space-y-2" aria-label={t('mode')}>
        {option('evenly', t('evenly'), t('evenlyHint'))}
        {option('listed', t('listed'), '')}
        {option('queue', t('queue'), t('queueHint'))}
      </fieldset>
      <ConfirmDialog
        open={confirmEvenly}
        tone="danger"
        title={t('confirmTitle')}
        message={t('confirmBody')}
        confirmLabel={t('confirm')}
        cancelLabel={tp('cancel')}
        busy={busy}
        onConfirm={() => {
          setConfirmEvenly(false);
          void evenly();
        }}
        onClose={() => setConfirmEvenly(false)}
      />
    </div>
  );
}
