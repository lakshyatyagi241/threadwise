'use client';

import { useTranslations } from 'next-intl';
import {
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  CHAT_DIRECTIONS,
  CHAT_FILLS,
  CHAT_FONTS,
  CHAT_SHAPES,
  CHAT_SIZES,
} from '@crm/contracts';
import { cn } from '@crm/ui';
import { ToggleRow } from './toggle-row';
import type { BuilderState } from '../lib/builder-model';

/** A row of choices as radio cards (one named group each). */
function Choice<T extends string>({
  name,
  label,
  value,
  options,
  text,
  onChange,
}: {
  name: string;
  label: string;
  value: T;
  options: readonly T[];
  text: (o: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
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
              name={`wgt-chat-${name}`}
              checked={value === o}
              onChange={() => onChange(o)}
              className="sr-only"
            />
            {text(o)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The chat window of a website chat bot beyond its colours: how reply buttons are filled and shaped, the typeface and size, the
 * suggestions under the conversation, and the small helpers (copy and thumbs under a bot line, the expand button, the voice
 * conversation).
 */
export function WebChatOptionsCard({
  s,
  set,
}: {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize.chat');
  const chat = s.launcher.chat;
  const setChat = (patch: Partial<typeof chat>) =>
    set({ launcher: { ...s.launcher, chat: { ...chat, ...patch } } });
  const toggle = (key: 'actions' | 'expand' | 'icons', label: string) => (
    <ToggleRow
      id={`wgt-f-chat-${key}`}
      checked={chat[key]}
      label={label}
      onChange={(value) => setChat({ [key]: value })}
    />
  );
  return (
    <fieldset data-testid="web-chat-options-card" className="space-y-4">
      <legend className="sr-only">{t('title')}</legend>
      <Choice
        name="size"
        label={t('size')}
        value={chat.size}
        options={CHAT_SIZES}
        text={(o) => t(`sizes.${o}`)}
        onChange={(size) => setChat({ size })}
      />
      <Choice
        name="fill"
        label={t('fill')}
        value={chat.fill}
        options={CHAT_FILLS}
        text={(o) => t(`fills.${o}`)}
        onChange={(fill) => setChat({ fill })}
      />
      <Choice
        name="shape"
        label={t('shape')}
        value={chat.shape}
        options={CHAT_SHAPES}
        text={(o) => t(`shapes.${o}`)}
        onChange={(shape) => setChat({ shape })}
      />
      <Choice
        name="font"
        label={t('font')}
        value={chat.font}
        options={CHAT_FONTS}
        text={(o) => t(`fonts.${o}`)}
        onChange={(font) => setChat({ font })}
      />
      <Choice
        name="direction"
        label={t('direction')}
        value={chat.direction}
        options={CHAT_DIRECTIONS}
        text={(o) => t(`directions.${o}`)}
        onChange={(direction) => setChat({ direction })}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="wgt-f-chat-fontSize"
            className="mb-1 block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground"
          >
            {t('fontSize', { value: chat.fontSize })}
          </label>
          <input
            id="wgt-f-chat-fontSize"
            type="range"
            min={CHAT_FONT_SIZE_MIN}
            max={CHAT_FONT_SIZE_MAX}
            value={chat.fontSize}
            onChange={(e) => setChat({ fontSize: Number(e.target.value) })}
            className="w-full accent-[var(--brand)]"
          />
        </div>
        <div>
          <label
            htmlFor="wgt-f-chat-hoverBg"
            className="mb-1 block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground"
          >
            {t('hoverBg')}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="wgt-f-chat-hoverBg"
              type="color"
              value={chat.hoverBg || '#efedfb'}
              onChange={(e) => setChat({ hoverBg: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-background p-1"
            />
            {chat.hoverBg !== '' ? (
              <button
                type="button"
                onClick={() => setChat({ hoverBg: '' })}
                className="text-[12px] font-semibold text-muted-foreground underline underline-offset-2"
              >
                {t('hoverBgReset')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {toggle('icons', t('icons'))}
        {toggle('actions', t('actions'))}
        {toggle('expand', t('expand'))}
      </div>
    </fieldset>
  );
}
