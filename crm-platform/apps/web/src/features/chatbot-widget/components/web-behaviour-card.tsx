'use client';

import { useTranslations } from 'next-intl';
import { CHAT_AUTO_OPEN_MAX, WIDGET_LIMITS } from '@crm/contracts';
import { cn } from '@crm/ui';
import { ConsentNoticeEditor } from '@/features/contact-consent';
import type { BuilderState } from '../lib/builder-model';
import { ToggleRow } from './toggle-row';
import { WidgetAgeQuestion } from './widget-age-question';

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-brand';
const CAPTION =
  'mb-2 block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground';

/**
 * How a website bot's chat window behaves: the opening message, what it asks the visitor first, when it opens by itself, the
 * sound, the voice (listening and reading aloud) and the devices it shows on.
 */
export function WebBehaviourCard({
  s,
  set,
  flash,
  domains,
  onDomains,
  widgetId = null,
}: {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  flash: string | null;
  /** The websites the chat may show on; empty means any. */
  domains: string[];
  onDomains: (next: string[]) => void;
  /** The bot's saved widget id; null until the look has been saved once. */
  widgetId?: string | null;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize.brand');
  const tv = useTranslations('chatbotWidget.builder.voice');
  const tc = useTranslations('chatbotWidget.flowBot.customize.chat');
  const chat = s.launcher.chat;
  const setChat = (patch: Partial<typeof chat>) =>
    set({ launcher: { ...s.launcher, chat: { ...chat, ...patch } } });
  return (
    <div data-testid="web-behaviour-card" className="space-y-6">
      <div>
        <label htmlFor="wgt-f-welcomeMessage" className={CAPTION}>
          {tv('opening')}
        </label>
        <textarea
          id="wgt-f-welcomeMessage"
          rows={3}
          value={s.welcomeMessage}
          maxLength={WIDGET_LIMITS.longText}
          placeholder={tv('openingPlaceholder')}
          aria-invalid={flash === 'welcomeMessage' || undefined}
          onChange={(e) => set({ welcomeMessage: e.target.value })}
          className={cn(INPUT, flash === 'welcomeMessage' && 'border-danger')}
        />
      </div>

      <div>
        <span className={CAPTION}>{tv('intake')}</span>
        <div className="space-y-1">
          {(
            [
              ['collectName', 'name'],
              ['collectEmail', 'email'],
              ['collectPhone', 'phone'],
            ] as const
          ).map(([field, key]) => (
            <ToggleRow
              key={field}
              id={`wgt-f-${field}`}
              checked={s[field]}
              label={tv(`intakeField.${key}`)}
              onChange={(on) => set({ [field]: on })}
            />
          ))}
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{tv('intakeHint')}</p>
        <div className="mt-3">
          <WidgetAgeQuestion s={s} set={set} />
        </div>
        {(s.collectEmail || s.collectPhone) && (
          <div className="mt-3">
            <ConsentNoticeEditor scope="widget" refId={widgetId ?? ''} disabled={!widgetId} />
          </div>
        )}
      </div>

      <div>
        <label htmlFor="wgt-f-chat-autoOpen" className={CAPTION}>
          {t('autoOpen')}
        </label>
        <input
          id="wgt-f-chat-autoOpen"
          type="number"
          min={0}
          max={CHAT_AUTO_OPEN_MAX}
          value={chat.autoOpen}
          onChange={(e) =>
            setChat({
              autoOpen: Math.min(
                CHAT_AUTO_OPEN_MAX,
                Math.max(0, Math.trunc(Number(e.target.value) || 0)),
              ),
            })
          }
          className={cn(INPUT, 'max-w-[120px]')}
        />
        <p className="mt-1 text-[11.5px] text-muted-foreground">{t('autoOpenHint')}</p>
      </div>

      <div className="space-y-1">
        <ToggleRow
          id="wgt-f-chat-sound"
          checked={chat.sound}
          label={t('sound')}
          onChange={(sound) => setChat({ sound })}
        />
        {chat.sound ? (
          <div className="pb-1">
            <label htmlFor="wgt-f-chat-volume" className="mb-1 block text-[11.5px] font-semibold">
              {t('soundVolume', { value: chat.soundVolume })}
            </label>
            <input
              id="wgt-f-chat-volume"
              type="range"
              min={0}
              max={100}
              value={chat.soundVolume}
              onChange={(e) => setChat({ soundVolume: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />
          </div>
        ) : null}
        <ToggleRow
          id="wgt-f-chat-voice"
          checked={chat.voice}
          label={tc('voice')}
          onChange={(voice) => setChat({ voice })}
        />
        <ToggleRow
          id="wgt-f-chat-pip"
          checked={chat.pip}
          label={t('pip')}
          hint={t('pipHint')}
          onChange={(pip) => setChat({ pip })}
        />
        <ToggleRow
          id="wgt-f-chat-speak"
          checked={chat.speak}
          label={t('speak')}
          onChange={(speak) => setChat({ speak })}
        />
      </div>

      <div>
        <ToggleRow
          id="wgt-f-domains-on"
          checked={domains.length > 0}
          label={t('domains.label')}
          onChange={(on) => onDomains(on ? [''] : [])}
        />
        <p className="mb-2 text-[11.5px] text-muted-foreground">{t('domains.hint')}</p>
        {domains.length > 0 ? (
          <div className="space-y-2">
            {domains.map((dom, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={dom}
                  maxLength={253}
                  placeholder={t('domains.placeholder')}
                  aria-label={t('domains.placeholder')}
                  onChange={(e) => onDomains(domains.map((x, j) => (j === i ? e.target.value : x)))}
                  className={INPUT}
                />
                <button
                  type="button"
                  aria-label={t('domains.remove')}
                  title={t('domains.remove')}
                  onClick={() => onDomains(domains.filter((_, j) => j !== i))}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                >
                  ×
                </button>
              </div>
            ))}
            {domains.length < 10 ? (
              <button
                type="button"
                onClick={() => onDomains([...domains, ''])}
                className="rounded-full border border-dashed border-border px-3.5 py-1.5 text-[12px] font-semibold text-brand hover:bg-muted"
              >
                + {t('domains.add')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div>
        <span className={CAPTION}>{t('devices.title')}</span>
        <div className="space-y-1">
          {(['desktop', 'tablet', 'mobile'] as const).map((d) => (
            <ToggleRow
              key={d}
              id={`wgt-f-chat-device-${d}`}
              checked={chat.devices[d]}
              label={t(`devices.${d}`)}
              onChange={(on) => setChat({ devices: { ...chat.devices, [d]: on } })}
            />
          ))}
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{t('devices.hint')}</p>
      </div>
    </div>
  );
}
