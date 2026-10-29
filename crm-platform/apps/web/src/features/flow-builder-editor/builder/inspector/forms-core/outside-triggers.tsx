'use client';

import { useTranslations } from 'next-intl';
import { FLB_SHEET_POLL_MINUTES } from '@crm/contracts';
import { useFlowWebhook } from '../../../api/hooks';
import { GoogleConnectionNotice } from '../forms-channels/google-connection';
import { GoogleFilePicker } from '../forms-channels/google';
import { Field, Notice, SelectInput, TextInput } from '../kit';
import type { FormProps } from '../types';

const NS = 'flb.builder.formsCore.trigger.outside';

/** The sample body the curl posts; the field names are the ones a flow reads back as `{{phone}}`, `{{name}}` and `{{order_id}}`. */
const SAMPLE_BODY = '{"phone":"+12025550123","name":"Asha","order_id":"A-1042"}';

/** The sample call for the address (the numbers are the fictional 202-555-01xx range). */
export function sampleHookCurl(address: string): string {
  return [
    `curl -X POST '${address}'`,
    "  -H 'Content-Type: application/json'",
    "  -H 'Idempotency-Key: order-A-1042'",
    `  -d '${SAMPLE_BODY}'`,
  ].join(' \\\n');
}

function CopyRow({ text, label, onCopied }: { text: string; label: string; onCopied: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(onCopied, () => undefined);
      }}
      className="shrink-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11.5px] font-medium hover:bg-muted"
    >
      {label}
    </button>
  );
}

/**
 * "When an outside system posts to this flow's address": the address (with a copy button), a sample call and how the body becomes
 * the contact and the run's variables. The address belongs to a saved flow and only works once the flow is published and active.
 */
export function WebhookTriggerFields({ env }: Pick<FormProps, 'env'>) {
  const t = useTranslations(NS);
  const q = useFlowWebhook(env.flowId);
  const address = q.data ? (q.data.url ?? q.data.path) : null;
  return (
    <>
      {env.flowId === null ? <Notice tone="warn">{t('saveFirst')}</Notice> : null}
      {env.flowId !== null ? (
        <Field label={t('addressLabel')} hint={t('addressHint')}>
          {q.isPending ? (
            <div className="text-[11.5px] text-muted-foreground">{t('loading')}</div>
          ) : q.isError || !address ? (
            <Notice tone="warn">{t('unavailable')}</Notice>
          ) : (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={address}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={t('addressLabel')}
                className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[11px]"
              />
              <CopyRow text={address} label={t('copy')} onCopied={() => env.toast(t('copied'))} />
            </div>
          )}
        </Field>
      ) : null}
      {q.data && !q.data.live ? <Notice tone="warn">{t('notLive')}</Notice> : null}
      {address ? (
        <Field label={t('sampleLabel')}>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-[10.5px] leading-snug">
            {sampleHookCurl(address)}
          </pre>
        </Field>
      ) : null}
      <Notice>
        {t('mapping', {
          fieldToken: '{{field}}',
          orderToken: '{{order_id}}',
          cityToken: '{{customer_city}}',
        })}
      </Notice>
      <Notice tone="warn">{t('secret')}</Notice>
    </>
  );
}

/** "When a new row is added to a Google Sheet": which sheet and tab, which columns hold the person, and how often to look. */
export function GoogleSheetTriggerFields(p: FormProps) {
  const t = useTranslations(NS);
  const { data: d, set } = p;
  return (
    <>
      <GoogleConnectionNotice need="sheets" />
      <Field label={t('sheetLabel')}>
        <GoogleFilePicker p={p} kind="sheets" dataKey="sheetId" />
      </Field>
      <Field label={t('tabLabel')} hint={t('tabHint')}>
        <TextInput value={d.tabName} placeholder="Sheet1" onChange={(v) => set('tabName', v)} />
      </Field>
      <Field label={t('phoneColumn')} hint={t('phoneColumnHint')}>
        <TextInput
          value={d.phoneColumn}
          placeholder="Phone"
          onChange={(v) => set('phoneColumn', v)}
        />
      </Field>
      <Field label={t('emailColumn')}>
        <TextInput
          value={d.emailColumn}
          placeholder="Email"
          onChange={(v) => set('emailColumn', v)}
        />
      </Field>
      <Field label={t('nameColumn')}>
        <TextInput value={d.nameColumn} placeholder="Name" onChange={(v) => set('nameColumn', v)} />
      </Field>
      <Field label={t('intervalLabel')} hint={t('intervalHint')}>
        <SelectInput
          value={String(d.intervalMinutes || 5)}
          options={FLB_SHEET_POLL_MINUTES.map((m) => ({
            v: String(m),
            l: t('minutes', { count: m }),
          }))}
          onChange={(v) => set('intervalMinutes', Number(v))}
        />
      </Field>
      <Notice>{t('sheetNote', { topicToken: '{{topic}}' })}</Notice>
    </>
  );
}
