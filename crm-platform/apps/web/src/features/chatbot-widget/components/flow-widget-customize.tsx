'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import type { FlowWidgetSaveInput, Widget } from '@crm/contracts';
import { Button, Spinner, cn, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { KEYS, saveFlowWidget, uploadFlowWidgetImage, useFlowWidget } from '../api/widgets';
import {
  fromWidget,
  newState,
  toPayload,
  validateStep,
  type BuilderState,
} from '../lib/builder-model';
import { WebChatPreview, type PreviewSurface } from './web-chat-preview';
import { WebBrandCard } from './web-brand-card';
import { WebConversationCard } from './web-conversation-card';
import { WebBehaviourCard } from './web-behaviour-card';
import { WebLauncherPreview } from './web-launcher-preview';
import { LaunchStep } from './builder-steps';
import { WebLauncherCard } from './web-launcher-card';
import { WebChatOptionsCard } from './web-chat-options-card';

/** The look a new website chat bot opens on: a violet header and buttons on a soft grey chat, the same as the chat window's own defaults. */
export const WEB_BOT_LOOK = {
  headerBg: '#5B4DDB',
  headerTextColor: '#FFFFFF',
  buttonColor: '#5B4DDB',
  actionButtonBg: '#5B4DDB',
  actionButtonTextColor: '#FFFFFF',
  messageBubbleColor: '#FFFFFF',
  messageTextColor: '#2C2E3D',
  bodyBgKind: 'color',
  bodyBgColor: '#F7F8FC',
} as const;

/** What a new bot's widget starts from: the builder's defaults under the bot's own name, in the website chat's own look, answered by the flow. */
const startingState = (flowName: string): BuilderState => {
  const base = newState();
  return {
    ...base,
    ...WEB_BOT_LOOK,
    mode: 'ai',
    name: flowName,
    // The gap a website chat launcher keeps from the screen: 24 px on a desktop, 16 px on a phone.
    launcher: {
      ...base.launcher,
      desktop: { side: 'right', sideSpacing: '24', bottomSpacing: '24' },
      mobile: { side: 'right', sideSpacing: '16', bottomSpacing: '16' },
    },
  };
};

/**
 * The Customize tab of a website chat bot: the widget's look, with the live preview beside it. Until it has been saved once the
 * bot has no widget (the default look is only a starting point), which is what keeps the reminder on and Publish locked.
 */
export function FlowWidgetCustomize({
  flowId,
  flowName,
  canEdit,
  onSaved,
}: {
  flowId: string;
  flowName: string;
  canEdit: boolean;
  onSaved?: (widget: Widget) => void;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize');
  const q = useFlowWidget(flowId);
  if (q.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (q.isError) return <p className="p-8 text-center text-[13px] text-danger">{t('loadError')}</p>;
  const widget = q.data.widget;
  return (
    <Panel
      // A save hands back a new row version: the form restarts from what the server stored.
      key={widget?.rowVersion ?? 'new'}
      flowId={flowId}
      initial={widget ? fromWidget(widget) : startingState(flowName)}
      initialDomains={widget?.allowedDomains ?? []}
      widgetId={widget?.id ?? null}
      untouched={widget === null}
      canEdit={canEdit}
      onSaved={onSaved}
    />
  );
}

function Panel({
  flowId,
  initial,
  initialDomains,
  widgetId,
  untouched,
  canEdit,
  onSaved,
}: {
  flowId: string;
  initial: BuilderState;
  initialDomains: string[];
  widgetId: string | null;
  untouched: boolean;
  canEdit: boolean;
  onSaved?: (widget: Widget) => void;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize');
  const tb = useTranslations('chatbotWidget.builder');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [s, setS] = useState(initial);
  const [domains, setDomains] = useState(initialDomains);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [surface, setSurface] = useState<PreviewSurface>('chat');
  const set = (patch: Partial<BuilderState>) => setS((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    for (const step of [2, 3]) {
      const p = validateStep(step, s);
      if (!p.ok) {
        toast(tb(`problem.${p.key}`), 'danger');
        setFlash(p.field);
        window.setTimeout(() => setFlash(null), 2600);
        document.getElementById(`wgt-f-${p.field}`)?.focus();
        return;
      }
    }
    if (s.launcher.popup.enabled && s.launcher.popup.text.trim() === '') {
      toast(t('launcher.popupTextRequired'), 'danger');
      setFlash('popupText');
      window.setTimeout(() => setFlash(null), 2600);
      document.getElementById('wgt-f-popupText')?.focus();
      return;
    }
    // The bot supplies the name and the answers; only the look is sent (a website chat bot has no WhatsApp number to open).
    const { name: _name, mode: _mode, assistantId: _assistant, ...look } = toPayload(s);
    const body: FlowWidgetSaveInput = {
      ...look,
      // The websites the chat may show on (empty: any); a blank line is not a website.
      allowedDomains: domains.map((x) => x.trim()).filter((x) => x !== ''),
      targetWhatsappCc: null,
      targetWhatsappNumber: null,
      ...(s.rowVersion === null ? {} : { rowVersion: s.rowVersion }),
    };
    setBusy(true);
    try {
      const saved = await saveFlowWidget(flowId, body);
      await qc.invalidateQueries({ queryKey: KEYS.flow(flowId) });
      void qc.invalidateQueries({ queryKey: KEYS.webBots });
      toast(t('saved'), 'success');
      onSaved?.(saved);
    } catch (e) {
      const detail = e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.message) : null;
      toast(detail ?? t('saveFailed'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const surfaces: PreviewSurface[] = ['chat', 'expanded', 'mobile', 'closed'];
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SectionId>('look');
  const goTo = (id: SectionId) => {
    setActive(id);
    document.getElementById(`cz-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // The rail follows the section at the top of the panel as it scrolls.
  const spy = () => {
    const box = scroller.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top + 24;
    let current: SectionId = SECTIONS[0]!.id;
    for (const sec of SECTIONS) {
      const el = document.getElementById(`cz-${sec.id}`);
      if (el && el.getBoundingClientRect().top <= top) current = sec.id;
    }
    setActive(current);
  };
  return (
    <div className="grid grid-cols-1 lg:h-[calc(100vh-10rem)] lg:min-h-[640px] lg:grid-cols-[64px_minmax(360px,32vw)_minmax(0,1fr)] xl:grid-cols-[64px_460px_minmax(0,1fr)]">
      <nav
        aria-label={t('rail.label')}
        data-testid="customize-rail"
        className="flex gap-1.5 overflow-x-auto border-b border-border bg-background p-2 lg:flex-col lg:items-center lg:overflow-visible lg:border-b-0 lg:border-e lg:py-3"
      >
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            data-rail={sec.id}
            aria-current={active === sec.id ? 'true' : undefined}
            onClick={() => goTo(sec.id)}
            className={cn(
              'flex w-[52px] shrink-0 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-bold',
              active === sec.id ? 'bg-brand/10 text-brand' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {RAIL_ICONS[sec.id]}
            </svg>
            {t(`rail.${sec.id}`)}
          </button>
        ))}
      </nav>
      <div
        data-testid="customize-sidebar"
        className="flex min-h-0 min-w-0 flex-col border-border bg-background lg:border-e"
      >
        <div
          ref={scroller}
          onScroll={spy}
          className="min-h-0 flex-1 space-y-8 overflow-y-auto p-5 pb-10"
        >
          {untouched ? (
            <p
              role="status"
              data-testid="customize-untouched"
              className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[12.5px]"
            >
              {t('untouched')}
            </p>
          ) : null}
          <Section id="look" title={t('groups.look')} lead={t('leads.look')}>
            <WebBrandCard
              s={s}
              set={set}
              flash={flash}
              upload={(slot, file) => uploadFlowWidgetImage(flowId, slot, file)}
            />
          </Section>
          <Section id="window" title={t('groups.window')} lead={t('leads.window')}>
            <WebChatOptionsCard s={s} set={set} />
            <div className="space-y-3 border-t border-border pt-5">
              <h3 className="text-[13px] font-bold">{t('groups.chat')}</h3>
              <WebConversationCard
                flowId={flowId}
                s={s}
                set={set}
                upload={(slot, file) => uploadFlowWidgetImage(flowId, slot, file)}
              />
            </div>
          </Section>
          <Section id="launcher" title={t('groups.launcher')} lead={t('leads.launcher')}>
            <fieldset>
              <legend className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                {t('position')}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {(['bottom_right', 'bottom_left'] as const).map((p) => (
                  <label
                    key={p}
                    className={cn(
                      'cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold focus-within:ring-2 focus-within:ring-brand',
                      s.position === p
                        ? 'border-brand bg-brand text-brand-foreground'
                        : 'border-border hover:border-brand',
                    )}
                  >
                    <input
                      type="radio"
                      name="flow-widget-position"
                      checked={s.position === p}
                      onChange={() => set({ position: p })}
                      className="sr-only"
                    />
                    {t(p === 'bottom_right' ? 'right' : 'left')}
                  </label>
                ))}
              </div>
            </fieldset>
            <WebLauncherCard
              s={s}
              set={set}
              upload={(file) => uploadFlowWidgetImage(flowId, 'popup', file)}
            />
          </Section>
          <Section id="behave" title={t('groups.behave')} lead={t('leads.behave')}>
            <WebBehaviourCard
              s={s}
              set={set}
              flash={flash}
              domains={domains}
              onDomains={setDomains}
              widgetId={widgetId}
            />
          </Section>
          <Section id="launch" title={t('groups.launch')} lead={t('leads.launch')}>
            <LaunchStep
              s={s}
              set={set}
              flash={flash}
              plain
              snippet={null}
              onCopy={() => undefined}
            />
            <p className="text-[12px] text-muted-foreground">{t('launchNote')}</p>
          </Section>
        </div>
        {canEdit ? (
          <div className="border-t border-border bg-background px-5 py-3">
            <Button
              variant="brand"
              disabled={busy}
              onClick={() => void save()}
              className="h-10 w-full whitespace-nowrap"
            >
              {t('save')}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col bg-muted/40 p-4 sm:p-6" data-testid="customize-stage">
        <div className="mx-auto mb-4 flex w-fit flex-wrap justify-center gap-0.5 rounded-full border border-border bg-background p-1">
          {surfaces.map((k) => (
            <button
              key={k}
              type="button"
              data-surface={k}
              aria-pressed={surface === k}
              onClick={() => setSurface(k)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[12.5px] font-bold',
                surface === k
                  ? 'bg-brand text-brand-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`surfaces.${k}`)}
            </button>
          ))}
        </div>
        {/* A site's page behind the widget, as a visitor meets it. */}
        <div className="relative min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-background p-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid auto-rows-[84px] grid-cols-4 content-start gap-3 p-5 opacity-80"
          >
            <i className="col-span-4 h-3 w-32 rounded-md bg-muted" />
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} className="rounded-xl bg-muted/70" />
            ))}
          </div>
          <div className="relative">
            {surface === 'closed' ? (
              <WebLauncherPreview flowId={flowId} s={s} />
            ) : (
              <WebChatPreview flowId={flowId} s={s} surface={surface} />
            )}
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">{t('preview.hint')}</p>
      </div>
    </div>
  );
}

type SectionId = 'look' | 'window' | 'launcher' | 'behave' | 'launch';

/** The rail's entries, in the order the sections appear in the panel. */
const RAIL_ICONS: Record<SectionId, ReactNode> = {
  look: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-1.9-.3-1 .4-2.1 1.5-2.1H17a4 4 0 0 0 4-4c0-5-4-10-9-10Z" />
      <circle cx="7.5" cy="12" r="1" />
      <circle cx="10" cy="7.5" r="1" />
      <circle cx="15" cy="7.5" r="1" />
    </>
  ),
  window: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />,
  launcher: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  behave: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  launch: (
    <>
      <path d="M5 15c-1.5 1.3-2 4-2 6 2 0 4.7-.5 6-2M14 5c2.5-2 5.5-2 7-2 0 1.5 0 4.5-2 7l-5 5-5-5 5-5Z" />
      <path d="M9 11l-4-1 2-3 4 0M13 15l1 4 3-2 0-4" />
      <circle cx="15" cy="9" r="1" />
    </>
  ),
};

const SECTIONS: { id: SectionId }[] = [
  { id: 'look' },
  { id: 'window' },
  { id: 'launcher' },
  { id: 'behave' },
  { id: 'launch' },
];

/** One section of the settings panel: a heading, a line of lead and its controls. */
function Section({
  id,
  title,
  lead,
  children,
}: {
  id: SectionId;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <section id={`cz-${id}`} data-group={id} className="scroll-mt-4 space-y-5">
      <header>
        <h2 className="text-[16px] font-bold">{title}</h2>
        <p className="text-[12.5px] text-muted-foreground">{lead}</p>
      </header>
      {children}
    </section>
  );
}
