'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
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

/** The channels whose bots have a widget and so the Customize and Deploy tabs: website chat and WhatsApp. */
export type WidgetChannel = 'web' | 'chat';

/** The pages of a builder: Build always, FAQs for every saved flow in the Simple builder, Customize and Deploy for a website bot. */
export type BuilderTab = 'build' | 'faqs' | 'customize' | 'deploy';

const ORDER: readonly BuilderTab[] = ['build', 'faqs', 'customize', 'deploy'];

/** Which tabs a builder offers. */
export interface TabSet {
  /** The FAQs tab (the Simple builder, for a person who may read FAQs). */
  faqs: boolean;
  /** Customize and Deploy (the bot is built for website chat). */
  web: boolean;
}

/** The tabs a builder shows, in order. */
export const tabsOf = (set: TabSet): BuilderTab[] =>
  ORDER.filter((k) => k === 'build' || (k === 'faqs' ? set.faqs : set.web));

/**
 * The tab a link asks for (`?tab=faqs`, `?tab=customize` from the Web channel list); anything else, and a tab this builder does not
 * offer, opens on Build.
 */
export function tabFromParam(
  value: string | null,
  set: TabSet = { faqs: true, web: true },
): BuilderTab {
  // `install` is the old name of Deploy.
  const wanted = value === 'install' ? 'deploy' : value;
  return ORDER.find((k) => k === wanted && tabsOf(set).includes(k)) ?? 'build';
}

/**
 * The tab in state, mirrored in the address (`?tab=`, and `view` for the FAQs panel) so a reload, a shared link and the back
 * button land on the same tab. Changing the tab never touches the flow being edited: the Build page stays mounted underneath.
 */
export function useBuilderTab(
  exists: boolean,
  set: TabSet,
): [BuilderTab, (tab: BuilderTab) => void] {
  const params = useSearchParams();
  const urlTab = params.get('tab');
  const [tab, setTabState] = useState<BuilderTab>(() =>
    exists ? tabFromParam(urlTab, set) : 'build',
  );
  // A link or the back button changed the address: follow it (state adjusted while rendering, not in an effect).
  const [seen, setSeen] = useState(urlTab);
  if (seen !== urlTab) {
    setSeen(urlTab);
    if (exists) setTabState(tabFromParam(urlTab, set));
  }
  const setTab = useCallback(
    (next: BuilderTab) => {
      setTabState(next);
      if (!exists) return;
      const q = new URLSearchParams(window.location.search);
      if (next === 'build') q.delete('tab');
      else q.set('tab', next);
      if (next !== 'faqs') q.delete('view');
      const search = q.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`,
      );
    },
    [exists],
  );
  return [tab, setTab];
}

/**
 * Build · FAQs · Customize · Deploy, under the header of a builder. FAQs, Customize and Deploy need the flow to exist (a
 * "save first" tooltip says so), and an amber dot stays on Customize until the widget has been saved once. A builder with
 * nothing but Build shows no bar.
 */
export function BuilderTabs({
  tab,
  onTab,
  saved,
  needsCustomizing,
  faqs,
  web,
}: {
  tab: BuilderTab;
  onTab: (tab: BuilderTab) => void;
  /** The flow has been saved at least once (it has an id). */
  saved: boolean;
  needsCustomizing: boolean;
  faqs: boolean;
  web: boolean;
}) {
  const t = useTranslations('flb.builder.webBot');
  const tabs = tabsOf({ faqs, web });
  if (tabs.length < 2) return null;
  return (
    <div
      role="tablist"
      aria-label={t('aria')}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-background px-4"
    >
      {tabs.map((k) => {
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
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50 ${
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
  tab: BuilderTab;
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
