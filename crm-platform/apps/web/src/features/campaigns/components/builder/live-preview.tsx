'use client';

import { useTranslations } from 'next-intl';
import type { CampaignBuilder } from '@crm/contracts';
import { editorType, type BuilderForm } from '../../lib/builder-model';
import { isLimitedEngine } from '../../lib/engine-gate';
import { BubbleIcon } from './parts';

/**
 * The column beside the steps: how the message will look in a chat, and four tiles (recipients, schedule, type, A/B) that follow
 * the form as it is filled in.
 */
export function LivePreview({
  form,
  builder,
  engine,
  senderLabel,
  recipients,
  step,
  stepCount,
}: {
  form: BuilderForm;
  builder: CampaignBuilder | undefined;
  engine: string;
  senderLabel: string | null;
  recipients: number;
  step: number;
  stepCount: number;
}) {
  const t = useTranslations('campaigns.builder.preview');
  const kind = editorType(form.type);
  const template = builder?.templates.find((x) => x.id === form.templateId);
  const buttons = isLimitedEngine(engine) ? [] : form.buttons.filter((b) => b.text.trim());
  const empty =
    kind === 'flow'
      ? form.flowId === ''
      : kind === 'template'
        ? !template
        : form.customMessage.trim() === '' && form.customHeader.trim() === '';
  const typeWord = kind === 'text' || kind === 'custom' ? t('typeText') : t(`type.${kind}`);
  const schedule =
    form.scheduleType === 'now'
      ? t('now')
      : form.scheduleType === 'recurring'
        ? t('recurring')
        : t('scheduled');

  return (
    <aside aria-label={t('title')} className="space-y-4 xl:sticky xl:top-20">
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('title')}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px] text-brand">
            {typeWord}
          </span>
        </div>
        <div className="p-4">
          {empty ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand/10 text-brand">
                <BubbleIcon className="size-5" />
              </span>
              <div className="mt-3 text-[15px] font-semibold">{t('emptyTitle')}</div>
              <p className="mt-1 text-[12px] text-muted-foreground">{t('emptyHint')}</p>
            </div>
          ) : (
            <div className="rounded-xl p-3" style={{ background: '#e5ddd5' }}>
              <div
                className="max-w-[300px] rounded-2xl rounded-tl-md px-3.5 py-2.5 shadow-sm"
                style={{ background: '#fff', color: '#111' }}
              >
                {kind === 'template' ? (
                  <div className="text-[13px]">
                    <div className="font-semibold">{template?.name}</div>
                    <div className="mt-1 whitespace-pre-wrap opacity-80">{template?.body}</div>
                  </div>
                ) : kind === 'flow' ? (
                  <div className="text-[13px] opacity-70">{t('flow')}</div>
                ) : (
                  <>
                    {form.customHeader.trim() && (
                      <div className="mb-1 text-[13px] font-semibold">{form.customHeader}</div>
                    )}
                    {form.mediaUrl.trim() && (
                      <div className="mb-1.5 break-all font-mono text-[11px] opacity-70">
                        📎 {form.mediaUrl.trim().split('/').pop()}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words text-[13px] leading-snug">
                      {form.customMessage}
                    </div>
                    {form.customFooter.trim() && (
                      <div className="mt-1 text-[11px] opacity-60">{form.customFooter}</div>
                    )}
                    {buttons.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {buttons.map((b, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-black/10 px-2.5 py-1 text-center text-[12px]"
                            style={{ color: '#027eb5' }}
                          >
                            {b.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <div className="mt-1 text-end font-mono text-[9.5px] opacity-50">12:00</div>
              </div>
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            {senderLabel ? t('from', { sender: senderLabel }) : t('note')}
          </p>
        </div>
      </div>

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
      <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {t('step', { n: step, total: stepCount })}
      </p>
    </aside>
  );
}
