'use client';

import { useTranslations } from 'next-intl';
import { intakeSummary, previewImageUrl, type BuilderState } from '../lib/builder-model';

const MODE_KEY = { ai: 'ai', whatsapp: 'whatsapp', both: 'both' } as const;

/**
 * The live preview of the builder (WD-WGT-002): a phone frame showing the header, the opening bubble and the send button
 * as the chat window will draw them, plus four cards for the settings the frame cannot show. It repaints on every input.
 */
export function BuilderPreview({ s }: { s: BuilderState }) {
  const t = useTranslations('chatbotWidget.builder.preview');
  const image = s.bodyBgKind === 'image' ? previewImageUrl(s.bodyBgImageUrl) : null;
  const engine = t(`engine.${MODE_KEY[s.mode]}`);
  const intake = intakeSummary(s);

  const body: React.CSSProperties = image
    ? { backgroundImage: `url("${image}")`, backgroundSize: 'cover' }
    : {
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(7,94,84,0.09) 1px, transparent 0)',
        backgroundSize: '18px 18px',
        backgroundColor: s.bodyBgColor || '#ECE5DD',
      };

  return (
    <aside className="space-y-4">
      <div className="rounded-2xl border border-border bg-background p-4 shadow-sm xl:sticky xl:top-[92px]">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('title')}
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] text-emerald-900">
            {engine}
          </span>
        </div>

        <div className="rounded-[24px] border border-foreground/10 bg-foreground/90 p-2 shadow-md">
          <div
            className="flex flex-col overflow-hidden rounded-[19px] bg-muted"
            style={{ height: 420 }}
          >
            <div
              data-testid="preview-header"
              className="flex h-11 shrink-0 items-center px-3 text-[12.5px] font-semibold"
              style={{ background: s.headerBg || '#075E54', color: s.headerTextColor || '#FFFFFF' }}
            >
              <span>{s.headerTitle || t('chat')}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3" style={body}>
              <div
                data-testid="preview-welcome"
                className="max-w-[80%] rounded-lg px-3 py-2 text-xs shadow-sm"
                style={{
                  background: s.messageBubbleColor || '#FFFFFF',
                  color: s.messageTextColor || '#222222',
                }}
              >
                {s.welcomeMessage || t('hi')}
              </div>
            </div>
            <div className="shrink-0 border-t border-border bg-background p-2.5">
              <button
                type="button"
                tabIndex={-1}
                data-testid="preview-button"
                className="w-full rounded-md py-1.5 text-xs font-semibold transition"
                style={{
                  background: s.actionButtonBg || '#075E54',
                  color: s.actionButtonTextColor || '#FFFFFF',
                }}
              >
                {s.buttonLabel || t('send')}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Meta label={t('metaEngine')} value={engine} />
          <Meta
            label={t('metaPlacement')}
            value={s.position === 'bottom_left' ? t('left') : t('right')}
          />
          <Meta label={t('metaAutoOpen')} value={s.autoOpen ? t('on') : t('off')} />
          <Meta label={t('metaIntake')} value={intake.length ? intake.join(' + ') : t('none')} />
        </div>
      </div>
    </aside>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/60 p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base leading-tight">{value}</div>
    </div>
  );
}
