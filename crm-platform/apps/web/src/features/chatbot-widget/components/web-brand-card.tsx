'use client';

import { useTranslations } from 'next-intl';
import { CHAT_CORNERS, CHAT_HEADERS, WIDGET_LIMITS } from '@crm/contracts';
import { cn } from '@crm/ui';
import type { BuilderState } from '../lib/builder-model';
import { ColorField } from './color-field';
import { PictureTile } from './picture-tile';

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-brand';
const CAPTION =
  'mb-2 block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground';

/** The primary colours on offer; the fourth-from-last is the default violet of a new bot. */
export const PRIMARY_COLOURS = [
  '#5B4DDB',
  '#0B7A5E',
  '#1D4ED8',
  '#BE123C',
  '#EA580C',
  '#6B21A8',
  '#14213D',
];

function Pills<T extends string>({
  name,
  value,
  options,
  text,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly T[];
  text: (o: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <label
          key={o}
          data-choice={`${name}:${o}`}
          className={cn(
            'cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold focus-within:ring-2 focus-within:ring-brand',
            value === o
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-border hover:border-brand',
          )}
        >
          <input
            type="radio"
            name={`wgt-brand-${name}`}
            checked={value === o}
            onChange={() => onChange(o)}
            className="sr-only"
          />
          {text(o)}
        </label>
      ))}
    </div>
  );
}

/**
 * The first section of a website bot's Customize tab, in the order of the design: the three pictures (company logo, bot picture and
 * chat background: SVG, PNG, GIF, JPG or WebP, uploaded here and served from our address so any visitor's browser can load them),
 * the bot's name, the primary colour (which tints the header, the launcher and the buttons together), the header's background, the
 * body corners, and a fold-out with every colour on its own.
 */
export function WebBrandCard({
  s,
  set,
  upload,
  flash,
}: {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  upload: (slot: 'logo' | 'avatar' | 'background', file: File) => Promise<string>;
  flash: string | null;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize.brand');
  const tl = useTranslations('chatbotWidget.builder.look');
  const tv = useTranslations('chatbotWidget.builder.voice');
  const tc = useTranslations('chatbotWidget.flowBot.customize.chat');
  const chat = s.launcher.chat;
  const setChat = (patch: Partial<typeof chat>) =>
    set({ launcher: { ...s.launcher, chat: { ...chat, ...patch } } });
  const primary = s.headerBg.toUpperCase();
  const pickPrimary = (hex: string) =>
    set({ headerBg: hex, buttonColor: hex, actionButtonBg: hex });
  const tile = (slot: 'logo' | 'avatar' | 'background') => (
    <PictureTile
      key={slot}
      id={`wgt-f-chat-${slot}`}
      label={t(`${slot}.label`)}
      value={chat[slot]}
      upload={(file) => upload(slot, file)}
      onChange={(value) => setChat({ [slot]: value })}
    />
  );
  return (
    <div data-testid="web-brand-card" className="space-y-6">
      <div>
        <span className={CAPTION}>{t('pictures')}</span>
        <div className="flex gap-2.5">
          {tile('logo')}
          {tile('avatar')}
          {tile('background')}
        </div>
      </div>

      <div>
        <label htmlFor="wgt-f-headerTitle" className={CAPTION}>
          {t('botName')}
        </label>
        <input
          id="wgt-f-headerTitle"
          type="text"
          value={s.headerTitle}
          maxLength={WIDGET_LIMITS.headerTitle}
          placeholder={tl('windowTitlePlaceholder')}
          aria-invalid={flash === 'headerTitle' || undefined}
          onChange={(e) => set({ headerTitle: e.target.value })}
          className={INPUT}
        />
      </div>

      <div>
        <span className={CAPTION}>{t('primary')}</span>
        <div className="flex flex-wrap items-center gap-2">
          {PRIMARY_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              data-primary={c}
              aria-label={c}
              aria-pressed={primary === c}
              onClick={() => pickPrimary(c)}
              style={{ background: c }}
              className={cn(
                'size-[30px] rounded-full border-2 border-background shadow-[0_0_0_1px_var(--border)] focus-visible:ring-2 focus-visible:ring-brand',
                primary === c && 'shadow-[0_0_0_2px_var(--brand)]',
              )}
            />
          ))}
          <input
            type="color"
            aria-label={t('primaryCustom')}
            title={t('primaryCustom')}
            value={/^#[0-9a-fA-F]{6}$/.test(s.headerBg) ? s.headerBg : '#5B4DDB'}
            onChange={(e) => pickPrimary(e.target.value.toUpperCase())}
            className="size-[30px] cursor-pointer rounded-full border border-border bg-background p-0.5"
          />
        </div>
      </div>

      <div>
        <span className={CAPTION}>{tc('header')}</span>
        <Pills
          name="header"
          value={chat.header}
          options={CHAT_HEADERS}
          text={(o) => tc(`headers.${o}`)}
          onChange={(header) => setChat({ header })}
        />
      </div>

      <div>
        <span className={CAPTION}>{t('corner')}</span>
        <Pills
          name="corner"
          value={chat.corner}
          options={CHAT_CORNERS}
          text={(o) => t(`corners.${o}`)}
          onChange={(corner) => setChat({ corner })}
        />
      </div>

      <details className="rounded-xl border border-border">
        <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] font-semibold">
          {t('fineTune')}
        </summary>
        <div className="grid grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-2">
          {(
            [
              ['buttonColor', tl('launcherFill'), s.buttonColor],
              ['headerBg', tl('headerTint'), s.headerBg],
              ['headerTextColor', tl('headerInk'), s.headerTextColor],
              ['messageBubbleColor', tv('bubbleFill'), s.messageBubbleColor],
              ['messageTextColor', tv('bubbleInk'), s.messageTextColor],
              ['bodyBgColor', tv('canvasColour'), s.bodyBgColor],
            ] as const
          ).map(([field, label, value]) => (
            <div key={field}>
              <label htmlFor={`wgt-f-${field}`} className="mb-1 block text-[11.5px] font-semibold">
                {label}
              </label>
              <ColorField
                id={`wgt-f-${field}`}
                label={label}
                value={value}
                invalid={flash === field}
                onChange={(v) => set({ [field]: v })}
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
