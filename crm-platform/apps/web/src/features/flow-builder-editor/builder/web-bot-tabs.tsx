'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FlowWidgetCustomize } from '@/features/chatbot-widget/components/flow-widget-customize';
import {
  FlowWhatsappCustomize,
  type WhatsappBotDefaults,
} from '@/features/chatbot-widget/components/flow-whatsapp-customize';
import { FlowWidgetDeploy } from '@/features/chatbot-widget/components/flow-widget-deploy';

/** What a WhatsApp bot's website button starts from, read off the bot's Trigger: the number it runs on and the word that starts it. */
export function whatsappDefaultsFrom(
  trigger: { data?: Record<string, unknown> | null } | undefined,
  senders: ReadonlyArray<{ key: string; label?: string; phone?: string | null }>,
): WhatsappBotDefaults {
  const d = trigger?.data ?? {};
  // A bot with no number chosen yet but exactly one connected number runs on that one.
  const chosen = String(d.deviceId ?? '');
  const key = chosen !== '' ? chosen : senders.length === 1 ? (senders[0]?.key ?? '') : '';
  const sender = senders.find((s) => s.key === key);
  const any = String(d.keywordMode ?? '') === 'any';
  const first = String(d.keywords ?? '')
    .split(/[,\n]/)
    .map((w) => w.trim())
    .find((w) => w !== '');
  return {
    phone: sender?.phone ?? null,
    numberLabel: sender?.label ?? '',
    keyword: any ? '' : (first ?? ''),
  };
}

export type WebBotTab = 'build' | 'customize' | 'deploy';

/** The channels whose bots have a widget and so the Customize and Deploy tabs: website chat and WhatsApp. */
export type WidgetChannel = 'web' | 'chat';

const TABS: readonly WebBotTab[] = ['build', 'customize', 'deploy'];

/** The tab a link asks for (`?tab=customize`, from the Web channel list); anything else opens on Build. `install` is the old name of Deploy. */
export function tabFromParam(value: string | null): WebBotTab {
  if (value === 'install') return 'deploy';
  return value === 'customize' || value === 'deploy' ? value : 'build';
}

/**
 * The tab to open on. Only a bot that already exists can start on Customize or Install; the others have nothing to show there,
 * and a bot that is not built for website chat has no tabs at all (the caller ignores the result for it).
 */
export function useInitialTab(exists: boolean): WebBotTab {
  const params = useSearchParams();
  return exists ? tabFromParam(params.get('tab')) : 'build';
}

/**
 * Build · Customize · Deploy, under the header of both builders when the bot is built for website chat or WhatsApp. Customize and
 * Deploy need the bot to exist, and an amber dot stays on Customize until the widget has been saved once.
 */
export function WebBotTabs({
  tab,
  onTab,
  saved,
  needsCustomizing,
}: {
  tab: WebBotTab;
  onTab: (tab: WebBotTab) => void;
  /** The bot has been saved at least once (it has an id). */
  saved: boolean;
  needsCustomizing: boolean;
}) {
  const t = useTranslations('flb.builder.webBot');
  return (
    <div
      role="tablist"
      aria-label={t('aria')}
      className="flex shrink-0 gap-1 border-b border-border bg-background px-4"
    >
      {TABS.map((k) => {
        const locked = k !== 'build' && !saved;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            id={`web-bot-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`web-bot-panel-${k}`}
            disabled={locked}
            title={locked ? t('saveFirst') : undefined}
            onClick={() => onTab(k)}
            className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              tab === k
                ? 'border-brand text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(k)}
            {k === 'customize' && needsCustomizing ? (
              <span
                data-testid="needs-customizing"
                title={t('needsCustomizing')}
                className="size-2 rounded-full bg-warning"
              >
                <span className="sr-only">{t('needsCustomizing')}</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The Customize and Deploy pages of a website chat or WhatsApp bot; the Build page is whatever the builder draws. */
export function WebBotPanels({
  tab,
  channel,
  flowId,
  flowName,
  published,
  canEdit,
  whatsapp,
}: {
  tab: WebBotTab;
  channel: WidgetChannel;
  flowId: string;
  flowName: string;
  published: boolean;
  canEdit: boolean;
  /** What a WhatsApp bot's button starts from (its number and keyword); ignored for website chat. */
  whatsapp: WhatsappBotDefaults;
}) {
  return (
    <>
      <div
        role="tabpanel"
        id="web-bot-panel-customize"
        aria-labelledby="web-bot-tab-customize"
        className={`min-h-0 flex-1 overflow-y-auto bg-muted ${tab === 'customize' ? '' : 'hidden'}`}
      >
        {channel === 'chat' ? (
          <FlowWhatsappCustomize
            flowId={flowId}
            flowName={flowName}
            canEdit={canEdit}
            defaults={whatsapp}
          />
        ) : (
          <FlowWidgetCustomize flowId={flowId} flowName={flowName} canEdit={canEdit} />
        )}
      </div>
      <div
        role="tabpanel"
        id="web-bot-panel-deploy"
        aria-labelledby="web-bot-tab-deploy"
        className={`min-h-0 flex-1 overflow-y-auto bg-background ${tab === 'deploy' ? '' : 'hidden'}`}
      >
        {tab === 'deploy' ? (
          <FlowWidgetDeploy flowId={flowId} channel={channel} published={published} />
        ) : null}
      </div>
    </>
  );
}
