'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FlowWidgetCustomize } from '@/features/chatbot-widget/components/flow-widget-customize';
import { FlowWidgetInstall } from '@/features/chatbot-widget/components/flow-widget-install';

export type WebBotTab = 'build' | 'customize' | 'install';

const TABS: readonly WebBotTab[] = ['build', 'customize', 'install'];

/** The tab a link asks for (`?tab=customize`, from the Web channel list); anything else opens on Build. */
export function tabFromParam(value: string | null): WebBotTab {
  return value === 'customize' || value === 'install' ? value : 'build';
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
 * Build · Customize · Install, under the header of both builders when the bot is built for website chat. Customize and Install
 * need the bot to exist, and an amber dot stays on Customize until the widget has been saved once.
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

/** The Customize and Install pages of a website chat bot; the Build page is whatever the builder draws. */
export function WebBotPanels({
  tab,
  flowId,
  flowName,
  published,
  canEdit,
}: {
  tab: WebBotTab;
  flowId: string;
  flowName: string;
  published: boolean;
  canEdit: boolean;
}) {
  return (
    <>
      <div
        role="tabpanel"
        id="web-bot-panel-customize"
        aria-labelledby="web-bot-tab-customize"
        className={`min-h-0 flex-1 overflow-y-auto bg-muted ${tab === 'customize' ? '' : 'hidden'}`}
      >
        <FlowWidgetCustomize flowId={flowId} flowName={flowName} canEdit={canEdit} />
      </div>
      <div
        role="tabpanel"
        id="web-bot-panel-install"
        aria-labelledby="web-bot-tab-install"
        className={`min-h-0 flex-1 overflow-y-auto bg-background ${tab === 'install' ? '' : 'hidden'}`}
      >
        {tab === 'install' ? <FlowWidgetInstall flowId={flowId} published={published} /> : null}
      </div>
    </>
  );
}
