'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Select, Spinner, Switch } from '@crm/ui';
import type { AutomationsView, StoreDashboard } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, saveAutomations, useAutomations } from '../../api/ecom';
import {
  AUTOMATION_GROUPS,
  DELAYS,
  VAR_FIELDS,
  autoKey,
  missingTemplate,
  parseVarCsv,
  templatesFor,
  toInput,
  type AutomationDraft,
  type Kind,
} from '../../lib/model';
import { CheckIcon } from '../ecom-icons';
import { primaryButton } from '../ui';

const control = 'h-9 text-[12.5px]';

function initial(
  view: AutomationsView,
  topics: readonly string[],
): Record<string, AutomationDraft> {
  const byType = new Map(view.automations.map((a) => [a.eventType, a]));
  return Object.fromEntries(
    topics.map((eventType) => {
      const a = byType.get(eventType);
      return [
        eventType,
        {
          eventType,
          isActive: a?.isActive ?? false,
          templateUuid: a?.templateUuid ?? '',
          varMap: a?.varMap ?? [],
          sendTo: a?.sendTo ?? 'customer',
          adminNumber: a?.adminNumber ?? '',
          delaySeconds: a?.delaySeconds ?? 0,
        } satisfies AutomationDraft,
      ];
    }),
  );
}

function Form({
  kind,
  storeId,
  data,
  view,
}: {
  kind: Kind;
  storeId: string;
  data: StoreDashboard;
  view: AutomationsView;
}) {
  const t = useTranslations('ecom.events');
  const g = useTranslations('ecom.autoGroups');
  const a = useTranslations('ecom.auto');
  const qc = useQueryClient();
  const canManage = useCan('ecom.automations.manage');
  const groups = AUTOMATION_GROUPS[kind];
  const topics = useMemo(() => groups.flatMap((x) => x.topics), [groups]);
  const [drafts, setDrafts] = useState(() => initial(view, topics));
  const [senderKey, setSenderKey] = useState(view.senderKey ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const fired = new Map(view.automations.map((x) => [x.eventType, x.fired]));
  const shopify = kind === 'shopify';

  const sender = data.woo?.senders.find((s) => s.key === senderKey);
  const templates = useMemo(
    () => templatesFor(data.templates, shopify ? undefined : sender),
    [data.templates, shopify, sender],
  );
  const set = (topic: string, patch: Partial<AutomationDraft>) =>
    setDrafts((d) => ({ ...d, [topic]: { ...d[topic]!, ...patch } }));

  // A sender change that makes a chosen template unusable clears it, as Reference's picker does.
  const pickSender = (key: string) => {
    setSenderKey(key);
    const next = templatesFor(
      data.templates,
      data.woo?.senders.find((s) => s.key === key),
    );
    setDrafts((d) =>
      Object.fromEntries(
        Object.entries(d).map(([k, v]) => [
          k,
          next.some((x) => x.uuid === v.templateUuid) ? v : { ...v, templateUuid: '' },
        ]),
      ),
    );
  };

  const save = async () => {
    const rows = topics.map((tp) => drafts[tp]!);
    if (missingTemplate(rows).length > 0) return setStatus({ ok: false, text: t('needTemplate') });
    setSaving(true);
    setStatus({ ok: true, text: t('saving') });
    try {
      const next = await saveAutomations(kind, storeId, {
        automations: rows.map(toInput),
        ...(shopify ? {} : { senderKey: senderKey === '' ? null : senderKey }),
      });
      qc.setQueryData(KEYS.automations(kind, storeId), next);
      await qc.invalidateQueries({ queryKey: KEYS.dashboard(kind, storeId) });
      setStatus({ ok: true, text: t('saved') });
      window.setTimeout(() => setStatus(null), 1800);
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiError ? e.message : t('saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const delayLabel = (sec: number) =>
    sec === 0
      ? t('immediate')
      : sec < 3600
        ? t('min', { n: sec / 60 })
        : sec < 86400
          ? t('hour', { n: sec / 3600 })
          : t('day', { n: sec / 86400 });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-5"
    >
      {data.templates.length === 0 && (
        <Alert tone="warning">
          {t('noTemplates')}{' '}
          <Link href="/templates" className="font-semibold underline">
            {t('templatesLink')}
          </Link>
        </Alert>
      )}

      {!shopify && data.woo && data.woo.senders.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[13px] font-semibold">{t('sendFrom')}</div>
            <div className="text-xs text-muted-foreground">{t('sendFromHint')}</div>
          </div>
          <Select
            aria-label={t('sendFrom')}
            value={senderKey}
            onChange={(e) => pickSender(e.target.value)}
            className="sm:max-w-xs"
            disabled={!canManage}
          >
            <option value="">{t('auto')}</option>
            {data.woo.senders.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} · {s.engine}
              </option>
            ))}
          </Select>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h3 className="text-[19px] font-normal">{g(`${group.key}.name`)}</h3>
            {shopify && (
              <span className="text-xs text-muted-foreground">{g(`${group.key}.desc`)}</span>
            )}
          </div>
          <div className="space-y-2">
            {group.topics.map((topic) => {
              const d = drafts[topic]!;
              const key = `${kind === 'shopify' ? 'shopify' : 'woocommerce'}.${autoKey(topic)}`;
              const tpl = templates.find((x) => x.uuid === d.templateUuid);
              const count = fired.get(topic) ?? 0;
              return (
                <div
                  key={topic}
                  className="rounded-2xl border border-border bg-background p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium">{a(`${key}.name`)}</div>
                      <div className="text-xs text-muted-foreground">
                        {a(`${key}.desc`)} <span className="font-mono">· {topic}</span>
                        {!shopify && <span> · {t('logged', { count })}</span>}
                      </div>
                    </div>
                    {shopify && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {t('fired', { count })}
                      </span>
                    )}
                    <div className="flex shrink-0 items-center gap-2">
                      {!shopify && <span className="text-xs text-muted-foreground">{t('on')}</span>}
                      <Switch
                        label={a(`${key}.name`)}
                        checked={d.isActive}
                        onCheckedChange={(v) => set(topic, { isActive: v })}
                        disabled={!canManage}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="space-y-1 text-[11px] text-muted-foreground">
                      {t('template')}
                      <Select
                        className={control}
                        value={d.templateUuid}
                        onChange={(e) =>
                          set(topic, {
                            templateUuid: e.target.value,
                            ...(shopify ? { varMap: [] } : {}),
                          })
                        }
                        disabled={!canManage}
                      >
                        <option value="">
                          — {shopify ? t('pickTemplate') : t('noneOption')} —
                        </option>
                        {templates.map((x) => (
                          <option key={x.uuid} value={x.uuid}>
                            {x.name} · {x.language.toUpperCase()}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="space-y-1 text-[11px] text-muted-foreground">
                      {t('sendTo')}
                      <Select
                        className={control}
                        value={d.sendTo}
                        onChange={(e) =>
                          set(topic, { sendTo: e.target.value as AutomationDraft['sendTo'] })
                        }
                        disabled={!canManage}
                      >
                        <option value="customer">{t('customer')}</option>
                        <option value="admin">{t('admin')}</option>
                        <option value="both">{t('both')}</option>
                      </Select>
                    </label>
                    {shopify && d.sendTo !== 'customer' && (
                      <label className="space-y-1 text-[11px] text-muted-foreground">
                        {t('adminNumber')}
                        <input
                          value={d.adminNumber}
                          onChange={(e) => set(topic, { adminNumber: e.target.value })}
                          maxLength={32}
                          disabled={!canManage}
                          className="h-9 w-full rounded-md border border-border bg-background px-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        />
                      </label>
                    )}
                    <label className="space-y-1 text-[11px] text-muted-foreground">
                      {t('delay')}
                      <Select
                        className={control}
                        value={d.delaySeconds}
                        onChange={(e) => set(topic, { delaySeconds: Number(e.target.value) })}
                        disabled={!canManage}
                      >
                        {DELAYS[kind].map((sec) => (
                          <option key={sec} value={sec}>
                            {delayLabel(sec)}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>

                  {shopify && tpl && tpl.paramCount > 0 && (
                    <div className="mt-3 rounded-xl bg-muted/50 p-3">
                      <div className="mb-2 text-[11px] font-medium">{t('mapTitle')}</div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {Array.from({ length: tpl.paramCount }, (_, i) => (
                          <label key={i} className="space-y-1 text-[11px] text-muted-foreground">
                            {t('param', { n: i + 1 })}
                            <Select
                              className={control}
                              value={d.varMap[i] ?? ''}
                              onChange={(e) => {
                                const next = Array.from({ length: tpl.paramCount }, (_, j) =>
                                  j === i ? e.target.value : (d.varMap[j] ?? ''),
                                );
                                set(topic, { varMap: next });
                              }}
                              disabled={!canManage}
                            >
                              <option value="">{t('blank')}</option>
                              {VAR_FIELDS.map((f) => (
                                <option key={f} value={f}>
                                  {t(`field.${f}`)}
                                </option>
                              ))}
                            </Select>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {!shopify && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">
                        {t('advanced')}
                      </summary>
                      <div className="mt-2 space-y-1">
                        <input
                          value={d.varMap.join(', ')}
                          onChange={(e) => set(topic, { varMap: parseVarCsv(e.target.value) })}
                          placeholder={t('advancedPlaceholder')}
                          disabled={!canManage}
                          className="h-9 w-full rounded-md border border-border bg-background px-3 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        />
                        <p className="text-[11px] text-muted-foreground">{t('advancedHint')}</p>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {canManage && (
        <div className="flex items-center justify-end gap-3">
          {status && (
            <span
              role="status"
              className={status.ok ? 'text-xs text-success' : 'text-xs text-danger'}
            >
              {status.text}
            </span>
          )}
          <button type="submit" disabled={saving} className={primaryButton}>
            <CheckIcon className="size-3.5" />
            {t('save')}
          </button>
        </div>
      )}
    </form>
  );
}

/** The automations tab (TW-ECOM-009, 033): every event grouped, each with its template, recipients, variables and delay. */
export function AutomationsTab({
  kind,
  storeId,
  data,
}: {
  kind: Kind;
  storeId: string;
  data: StoreDashboard;
}) {
  const automations = useAutomations(kind, storeId, true);
  if (automations.isPending)
    return (
      <div className="grid min-h-[20vh] place-items-center">
        <Spinner />
      </div>
    );
  if (automations.isError || !automations.data) return <Alert tone="danger">{kind}</Alert>;
  // Keyed on the saved version so a save from elsewhere (or a reload) rebuilds the form from what is stored.
  return (
    <Form
      key={JSON.stringify(automations.data.automations)}
      kind={kind}
      storeId={storeId}
      data={data}
      view={automations.data}
    />
  );
}
