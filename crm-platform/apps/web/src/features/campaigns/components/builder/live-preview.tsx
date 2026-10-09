'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CampaignBuilder, ComposeTemplate, WizardTemplate } from '@crm/contracts';
import type { PreviewModel } from '@/features/message-templates/lib/form-model';
import { editorType, type BuilderForm } from '../../lib/builder-model';
import { isLimitedEngine } from '../../lib/engine-gate';
import { previewModelOf } from '../../wizard/lib/templates';
import { BroadcastPreview } from './broadcast-preview';

const BUTTON_KIND: Record<string, PreviewModel['buttons'][number]['kind']> = {
  url: 'url',
  phone_number: 'phone',
  copy_code: 'copy_code',
  quick_reply: 'quick_reply',
};

/** A template of the classic builder's list, as the shared bubble draws it. */
const ofCompose = (t: ComposeTemplate): PreviewModel =>
  previewModelOf({ ...t, slots: [] } as unknown as WizardTemplate);

/**
 * The column beside the steps: the message as the recipient will see it (the shared preview: header bar, bubble, buttons as cards,
 * an A / B switch with an A/B test), four tiles (recipients, schedule, type, A/B) and whatever the screen adds under them (the guided
 * flow's audience and cost blocks). `pinned` keeps the column in view while the steps scroll.
 */
export function LivePreview({
  form,
  builder,
  engine,
  senderLabel,
  recipients,
  step,
  stepCount,
  model,
  modelB,
  pinned,
  children,
}: {
  form: BuilderForm;
  builder: CampaignBuilder | undefined;
  engine: string;
  senderLabel: string | null;
  recipients: number;
  step: number;
  stepCount: number;
  /**
   * A template message already turned into the shared bubble's model (the guided flow, where the campaign is always a template);
   * `null` is "no template chosen yet". Left out, the preview is built from the classic form.
   */
  model?: PreviewModel | null;
  /** Variant B's model in the guided flow (`null` until chosen); left out without an A/B test. */
  modelB?: PreviewModel | null;
  pinned?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('campaigns.builder.preview');
  const kind = editorType(form.type);
  const guided = model !== undefined;
  const templateOf = (id: string) => builder?.templates.find((x) => x.id === id);

  const custom = (message: string): PreviewModel | null => {
    const buttons = isLimitedEngine(engine)
      ? []
      : form.buttons
          .filter((b) => b.text.trim())
          .map((b) => ({ kind: BUTTON_KIND[b.type] ?? 'quick_reply', text: b.text }));
    if (message.trim() === '' && form.customHeader.trim() === '') return null;
    return {
      auth: false,
      language: '',
      headerKind: form.customHeader.trim() ? 'text' : 'none',
      headerText: form.customHeader,
      headerImageUrl: null,
      body: message,
      footer: form.customFooter,
      buttons,
      expiry: null,
    };
  };
  const classicA: PreviewModel | null =
    kind === 'template'
      ? templateOf(form.templateId)
        ? ofCompose(templateOf(form.templateId)!)
        : null
      : kind === 'flow'
        ? null
        : custom(form.customMessage);
  const classicB: PreviewModel | null | undefined = !form.abTesting
    ? undefined
    : kind === 'template'
      ? templateOf(form.templateIdB)
        ? ofCompose(templateOf(form.templateIdB)!)
        : null
      : kind === 'flow'
        ? null
        : custom(form.customMessageB.trim() ? form.customMessageB : form.customMessage);

  const a = guided ? model : classicA;
  const b = guided ? (form.abTesting ? (modelB ?? null) : undefined) : classicB;
  const typeWord = guided
    ? t('type.template')
    : kind === 'text' || kind === 'custom'
      ? t('typeText')
      : t(`type.${kind}`);
  const placeholder =
    kind === 'flow' && !guided
      ? { title: t('flowTitle'), hint: t('flow') }
      : { title: t('emptyTitle'), hint: t('emptyHint') };
  const schedule =
    form.scheduleType === 'now'
      ? t('now')
      : form.scheduleType === 'recurring'
        ? t('recurring')
        : t('scheduled');
  const initial = (senderLabel ?? '').trim().charAt(0) || 'W';

  return (
    <aside
      aria-label={t('title')}
      className={
        pinned
          ? 'space-y-4 xl:sticky xl:top-[12.5rem] xl:max-h-[calc(100dvh-13.5rem)] xl:overflow-y-auto xl:pe-1'
          : 'space-y-4 xl:sticky xl:top-20'
      }
    >
      <BroadcastPreview
        title={guided ? t('broadcastTitle') : t('title')}
        subtitle={
          guided || kind === 'template'
            ? t('templateMessage')
            : kind === 'flow'
              ? t('type.flow')
              : t('customMessage')
        }
        initial={guided ? 'WA' : initial}
        a={a}
        {...(b !== undefined ? { b } : {})}
        placeholder={placeholder}
      />
      <p className="px-1 text-[11px] text-muted-foreground">
        {senderLabel ? t('from', { sender: senderLabel }) : t('note')}
      </p>

      <dl className="grid grid-cols-2 gap-3">
        {[
          [t('recipients'), String(recipients)],
          [t('schedule'), schedule],
          [t('typeLabel'), typeWord],
          [t('ab'), form.abTesting ? `${form.abSplit}/${100 - form.abSplit}` : t('off')],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-background p-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {k}
            </dt>
            <dd className="mt-1 text-[18px] font-semibold leading-none">{v}</dd>
          </div>
        ))}
      </dl>
      {children}
      <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {t('step', { n: step, total: stepCount })}
      </p>
    </aside>
  );
}
