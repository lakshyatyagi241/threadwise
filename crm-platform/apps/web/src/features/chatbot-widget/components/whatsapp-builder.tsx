'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  DEFAULT_LAUNCHER_AVATAR,
  DEFAULT_POPUP_TEXT,
  LAUNCHER_ANIMATIONS,
  LAUNCHER_AVATARS,
  LAUNCHER_AVATAR_PREFIX,
  LAUNCHER_COLOUR_PRESETS,
  LAUNCHER_LIMITS,
  LAUNCHER_SIDES,
  LAUNCHER_TEXT,
  POPUP_POSITIONS,
  WIDGET_LIMITS,
  launcherAvatarSrc,
  resolveLauncherColour,
  type LauncherButtonType,
  type LauncherSide,
} from '@crm/contracts';
import { cn } from '@crm/ui';
import {
  snippetFor,
  swatchValue,
  type BuilderState,
  type LauncherDraft,
  type PlacementDraft,
  type WhatsappCard,
} from '../lib/builder-model';
import { BackIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, WhatsappGlyph } from './icons';
import { LauncherPreview, type PreviewDevice } from './launcher-preview';
import { ImageUpload } from './image-upload';
import { PhoneField } from './phone-field';

const INPUT =
  'w-full rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus-visible:border-emerald-600 focus-visible:ring-4 focus-visible:ring-emerald-600/10';
const LABEL = 'mb-1.5 block text-[12.5px] font-semibold';
const HINT = 'mt-1 text-[11px] text-muted-foreground';

const ring = (flash: string | null, field: string) =>
  flash === field ? 'border-danger ring-2 ring-danger/40' : 'border-border';

const gradient = (colour: string) => {
  const c = resolveLauncherColour(colour);
  return `linear-gradient(135deg, ${c.from}, ${c.to})`;
};

export interface WhatsappBuilderProps {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  flash: string | null;
  editing: boolean;
  saved: boolean;
  canSave: boolean;
  openCard: 0 | WhatsappCard;
  onOpenCard: (card: 0 | WhatsappCard) => void;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  defaultIso: string | null | undefined;
  snippet: { embedUrl: string; previewUrl: string } | null;
  onCopy: () => void;
  onSave: () => void;
  /**
   * Uploads a picture for the button (the logo or the popup image) and returns its address. Only a WhatsApp bot has somewhere to keep
   * one; without it the cards offer the address box alone.
   */
  upload?: (slot: 'logo' | 'popup', file: File) => Promise<string>;
  /**
   * Inside a WhatsApp bot's Customize tab: no page header, name or type (the bot supplies them), no number card (the number and the
   * message come from the bot's Trigger), and the embed code is on the Deploy tab.
   */
  embedded?: boolean;
}

/**
 * `/chatbot-widgets/create` and `/edit` for a WhatsApp widget (TW-WGT-028, user-requested Interakt reference): the page
 * "WhatsApp Widget: Install and Customize". A vertical list of five collapsible cards, one open at a time, a Save Changes
 * button under them and, always in view, a live preview of the launcher and the messenger panel.
 */
export function WhatsappBuilder(p: WhatsappBuilderProps) {
  const { s, set, flash } = p;
  const t = useTranslations('chatbotWidget.whatsappBuilder');
  const setup = useTranslations('chatbotWidget.builder.setup');
  const b = useTranslations('chatbotWidget.builder');

  const setLauncher = (patch: Partial<LauncherDraft>) =>
    set({ launcher: { ...s.launcher, ...patch } });
  const setPlacement = (device: 'desktop' | 'mobile', patch: Partial<PlacementDraft>) =>
    setLauncher({ [device]: { ...s.launcher[device], ...patch } });

  const cards: Array<{ n: WhatsappCard; body: React.ReactNode }> = [
    { n: 1, body: <StyleCard s={s} setLauncher={setLauncher} /> },
    {
      n: 2,
      body: (
        <MessengerCard
          s={s}
          setLauncher={setLauncher}
          flash={flash}
          upload={p.upload ? (file) => p.upload!('logo', file) : undefined}
        />
      ),
    },
    {
      n: 3,
      body: (
        <WelcomeCard
          s={s}
          set={set}
          setLauncher={setLauncher}
          flash={flash}
          bot={p.embedded === true}
        />
      ),
    },
    {
      n: 6,
      body: (
        <PopupCard
          s={s}
          setLauncher={setLauncher}
          flash={flash}
          upload={p.upload ? (file) => p.upload!('popup', file) : undefined}
        />
      ),
    },
    {
      n: 4,
      body: (
        <PositionCard
          s={s}
          setPlacement={setPlacement}
          flash={flash}
          device={p.device}
          onDevice={p.onDevice}
        />
      ),
    },
    { n: 5, body: <NumberCard s={s} set={set} flash={flash} defaultIso={p.defaultIso} /> },
  ];

  // The bot's own number and keyword fill the button, so a bot's Customize tab has no number card.
  const shown = p.embedded ? cards.filter((c) => c.n !== 5) : cards;

  return (
    <>
      {p.embedded ? null : (
        <div className="sticky top-0 z-20 border-b border-border bg-background">
          <div className="mx-auto flex max-w-none items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href="/chatbot-widgets"
                title={b('back')}
                aria-label={b('back')}
                className="flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted"
              >
                <BackIcon className="size-3.5" />
              </Link>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {b('crumb')} / {t('crumb')}
                </div>
                <h1 className="truncate text-xl leading-tight">
                  {t('title')} <span className="not-italic text-emerald-700">{t('titleAccent')}</span>
                </h1>
              </div>
            </div>
            <span
              data-testid="state-pill"
              className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium"
            >
              {p.saved ? b('stateSaved') : b('stateDraft')}
            </span>
          </div>
        </div>
      )}

      <section className="mx-auto max-w-none px-4 py-6 sm:px-6 lg:px-7">
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
          <div className="space-y-3" data-testid="whatsapp-builder">
            {p.embedded ? null : (
              <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
                  <div>
                    <label htmlFor="wgt-f-name" className={LABEL}>
                      {setup('name')} <span className="text-danger">*</span>
                    </label>
                    <input
                      id="wgt-f-name"
                      type="text"
                      value={s.name}
                      maxLength={WIDGET_LIMITS.name}
                      placeholder={setup('namePlaceholder')}
                      aria-invalid={flash === 'name' || undefined}
                      onChange={(e) => set({ name: e.target.value })}
                      className={cn(INPUT, ring(flash, 'name'))}
                    />
                    <div className={HINT}>{t('nameHint')}</div>
                  </div>
                  <fieldset>
                    <legend className={LABEL}>{t('type')}</legend>
                    <div className="flex flex-wrap gap-2">
                      {(['whatsapp', 'ai', 'both'] as const).map((mode) => (
                        <label
                          key={mode}
                          data-mode-tile={mode}
                          className={cn(
                            'cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-semibold transition focus-within:ring-2 focus-within:ring-primary',
                            s.mode === mode
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
                              : 'border-border text-muted-foreground hover:bg-muted',
                          )}
                        >
                          <input
                            type="radio"
                            name="wgt-mode"
                            value={mode}
                            checked={s.mode === mode}
                            onChange={() => set({ mode })}
                            className="sr-only"
                          />
                          {setup(`mode.${mode}.title`)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </div>
            )}

            {shown.map(({ n, body }) => {
              const open = p.openCard === n;
              return (
                <section
                  key={n}
                  data-card={n}
                  data-open={open}
                  className={cn(
                    'overflow-hidden rounded-2xl border bg-background shadow-sm transition-colors',
                    open ? 'border-emerald-500 ring-1 ring-emerald-500/30' : 'border-border',
                  )}
                >
                  <h2 className="m-0">
                    <button
                      type="button"
                      id={`wgt-card-head-${n}`}
                      aria-expanded={open}
                      aria-controls={`wgt-card-body-${n}`}
                      onClick={() => p.onOpenCard(open ? 0 : n)}
                      className="flex w-full items-center gap-3 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold leading-tight">
                          {t(`card.${n}.title`)}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-muted-foreground">
                          {t(`card.${n}.subtitle`)}
                        </span>
                      </span>
                      {open ? (
                        <ChevronUpIcon className="size-4 shrink-0" />
                      ) : (
                        <ChevronDownIcon className="size-4 shrink-0" />
                      )}
                    </button>
                  </h2>
                  <div
                    id={`wgt-card-body-${n}`}
                    role="region"
                    aria-labelledby={`wgt-card-head-${n}`}
                    hidden={!open}
                    className="border-t border-border px-5 py-5"
                  >
                    {body}
                  </div>
                </section>
              );
            })}

            <div className="flex items-center justify-end pt-1">
              {p.canSave && (
                <button
                  type="button"
                  id="wgt-save-changes"
                  onClick={p.onSave}
                  className="inline-flex h-11 items-center rounded-full bg-emerald-600 px-8 text-[14px] font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/30"
                >
                  {t('save')}
                </button>
              )}
            </div>

            {p.snippet && !p.embedded && (
              <div
                data-testid="install"
                className="rounded-2xl border border-emerald-500 bg-background p-5 shadow-sm"
              >
                <div className="text-[15px] font-semibold">{t('install.title')}</div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{t('install.body')}</p>
                <div className="mt-3 flex items-start gap-2">
                  <code
                    data-testid="snippet"
                    className="block min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-lg bg-muted px-3 py-2.5 font-mono text-[11.5px]"
                  >
                    {snippetFor(p.snippet.embedUrl)}
                  </code>
                  <button
                    type="button"
                    id="wgt-copy-snippet"
                    onClick={p.onCopy}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted"
                  >
                    <CopyIcon className="size-3.5" />
                    {t('install.copy')}
                  </button>
                </div>
              </div>
            )}
          </div>

          <LauncherPreview s={s} device={p.device} />
        </div>
      </section>
    </>
  );
}

// --- card 1: the chat button ------------------------------------------------------------------------------------------------

type LauncherSetter = (patch: Partial<LauncherDraft>) => void;

function ButtonSample({ type, colour }: { type: LauncherButtonType; colour: string }) {
  const t = useTranslations('chatbotWidget.whatsappBuilder');
  return type === 'pill' ? (
    <span
      className="inline-flex h-11 items-center gap-2 rounded-full ps-3 pe-4 text-[13px] font-bold text-white shadow-md"
      style={{ background: gradient(colour) }}
    >
      <WhatsappGlyph className="size-6" />
      {LAUNCHER_TEXT.pill}
    </span>
  ) : (
    <span
      className="inline-flex size-12 items-center justify-center rounded-full text-white shadow-md"
      style={{ background: gradient(colour) }}
      title={t('card.1.iconOnly')}
    >
      <WhatsappGlyph className="size-7" />
    </span>
  );
}

function StyleCard({ s, setLauncher }: { s: BuilderState; setLauncher: LauncherSetter }) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.card.1');
  const picker = useRef<HTMLInputElement>(null);
  const l = s.launcher;
  const custom = !LAUNCHER_COLOUR_PRESETS.some((c) => c.key === l.colour);
  return (
    <div>
      <fieldset className="mb-6">
        <legend className={LABEL}>{t('buttonType')}</legend>
        <div className="flex flex-wrap gap-3">
          {(['pill', 'icon'] as const).map((type) => {
            const active = l.buttonType === type;
            return (
              <label
                key={type}
                data-button-type={type}
                className={cn(
                  'flex min-h-[84px] min-w-[170px] cursor-pointer items-center gap-3 rounded-xl border p-3 transition focus-within:ring-2 focus-within:ring-primary',
                  active
                    ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30'
                    : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="wgt-button-type"
                  value={type}
                  checked={active}
                  onChange={() => setLauncher({ buttonType: type })}
                  className="size-4 accent-emerald-600"
                  aria-label={t(`type.${type}`)}
                />
                <ButtonSample type={type} colour={l.colour} />
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className={LABEL}>{t('buttonColor')}</legend>
        <div role="radiogroup" aria-label={t('buttonColor')} className="flex flex-wrap gap-2.5">
          {LAUNCHER_COLOUR_PRESETS.map((c) => {
            const active = l.colour === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={active}
                data-colour={c.key}
                onClick={() => setLauncher({ colour: c.key })}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-[12.5px] font-medium transition hover:bg-muted',
                  active
                    ? 'border-violet-600 outline outline-2 outline-violet-600'
                    : 'border-border',
                )}
              >
                <span
                  className="size-4 rounded-full"
                  style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}
                  aria-hidden="true"
                />
                {c.name}
              </button>
            );
          })}
          {custom && (
            <span
              role="radio"
              aria-checked
              data-colour="custom"
              className="inline-flex items-center gap-2 rounded-full border border-violet-600 bg-background px-3 py-1.5 text-[12.5px] font-medium outline outline-2 outline-violet-600"
            >
              <span
                className="size-4 rounded-full"
                style={{ background: gradient(l.colour) }}
                aria-hidden="true"
              />
              {t('custom', { hex: l.colour.toUpperCase() })}
            </span>
          )}
        </div>
        <div className="mt-3">
          <button
            type="button"
            id="wgt-custom-colour"
            onClick={() => picker.current?.click()}
            className="text-[12.5px] font-semibold text-violet-700 underline underline-offset-2 hover:text-violet-900 dark:text-violet-300"
          >
            {t('pickCustom')}
          </button>
          <input
            ref={picker}
            id="wgt-f-customColour"
            type="color"
            tabIndex={-1}
            aria-label={t('pickCustom')}
            value={swatchValue(l.colour)}
            onChange={(e) => setLauncher({ colour: e.target.value.toUpperCase() })}
            className="sr-only"
          />
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className={LABEL}>{t('animation')}</legend>
        <div className="flex flex-wrap gap-2">
          {LAUNCHER_ANIMATIONS.map((a) => (
            <label
              key={a}
              data-animation={a}
              className={cn(
                'cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition focus-within:ring-2 focus-within:ring-primary',
                l.animation === a
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name="wgt-animation"
                value={a}
                checked={l.animation === a}
                onChange={() => setLauncher({ animation: a })}
                className="sr-only"
              />
              {t(`animations.${a}`)}
            </label>
          ))}
        </div>
        <div className={HINT}>{t('animationHint')}</div>
      </fieldset>
    </div>
  );
}

// --- card 2: the messenger image --------------------------------------------------------------------------------------------

function MessengerCard({
  s,
  setLauncher,
  flash,
  upload,
}: {
  s: BuilderState;
  setLauncher: LauncherSetter;
  flash: string | null;
  upload: ((file: File) => Promise<string>) | undefined;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.card.2');
  const avatar = s.launcher.avatar;
  const isPreset = avatar.startsWith(LAUNCHER_AVATAR_PREFIX);
  return (
    <div>
      <div className="mb-5">
        <label htmlFor="wgt-f-botName" className={LABEL}>
          {t('botName')}
        </label>
        <input
          id="wgt-f-botName"
          type="text"
          value={s.launcher.botName}
          maxLength={LAUNCHER_LIMITS.botName}
          placeholder={s.name}
          onChange={(e) => setLauncher({ botName: e.target.value })}
          className={cn(INPUT, 'border-border')}
        />
        <div className={HINT}>
          {t('botNameHint')} {s.launcher.botName.length}/{LAUNCHER_LIMITS.botName}
        </div>
      </div>
      <fieldset className="mb-5">
        <legend className={LABEL}>{t('image')}</legend>
        <div className="flex flex-wrap gap-3">
          {LAUNCHER_AVATARS.map((a) => {
            const value = `${LAUNCHER_AVATAR_PREFIX}${a.key}`;
            const active = avatar === value;
            return (
              <label
                key={a.key}
                data-avatar={a.key}
                className={cn(
                  'flex w-[92px] cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-2.5 text-[11.5px] font-medium transition focus-within:ring-2 focus-within:ring-primary',
                  active
                    ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30'
                    : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="wgt-avatar"
                  value={value}
                  checked={active}
                  onChange={() => setLauncher({ avatar: value })}
                  className="sr-only"
                />
                <img
                  src={launcherAvatarSrc(value)}
                  alt=""
                  className="size-12 rounded-full object-cover"
                />
                {t(`names.${a.key}`)}
              </label>
            );
          })}
        </div>
      </fieldset>
      <label htmlFor="wgt-f-avatar" className={LABEL}>
        {t('url')}
      </label>
      <input
        id="wgt-f-avatar"
        type="url"
        inputMode="url"
        value={isPreset ? '' : avatar}
        maxLength={LAUNCHER_LIMITS.avatar}
        placeholder="https://example.com/logo.png"
        aria-invalid={flash === 'avatar' || undefined}
        onChange={(e) =>
          setLauncher({ avatar: e.target.value === '' ? DEFAULT_LAUNCHER_AVATAR : e.target.value })
        }
        className={cn(INPUT, ring(flash, 'avatar'))}
      />
      <div className={HINT}>{t(upload ? 'urlHintUpload' : 'urlHint')}</div>
      <ImageUpload
        id="wgt-f-avatarFile"
        value={avatar.startsWith(LAUNCHER_AVATAR_PREFIX) ? '' : avatar}
        upload={upload}
        onChange={(v) => setLauncher({ avatar: v === '' ? DEFAULT_LAUNCHER_AVATAR : v })}
      />
    </div>
  );
}

// --- card 3: greeting and intro ---------------------------------------------------------------------------------------------

function WelcomeCard({
  s,
  set,
  setLauncher,
  flash,
  bot,
}: {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  setLauncher: LauncherSetter;
  flash: string | null;
  /** A WhatsApp bot's button: the message a tap sends is set here (the Chat widget page sets it with the number). */
  bot: boolean;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.card.3');
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="wgt-f-greeting" className={LABEL}>
          {t('greeting')}
        </label>
        <input
          id="wgt-f-greeting"
          type="text"
          value={s.launcher.greeting}
          maxLength={LAUNCHER_LIMITS.greeting}
          placeholder="HI THERE!"
          aria-invalid={flash === 'greeting' || undefined}
          onChange={(e) => setLauncher({ greeting: e.target.value })}
          className={cn(INPUT, ring(flash, 'greeting'))}
        />
        <div className={HINT}>{t('greetingHint')}</div>
      </div>
      <div>
        <label htmlFor="wgt-f-introMessage" className={LABEL}>
          {t('intro')}
        </label>
        <textarea
          id="wgt-f-introMessage"
          rows={4}
          value={s.launcher.introMessage}
          maxLength={LAUNCHER_LIMITS.intro}
          aria-invalid={flash === 'introMessage' || undefined}
          onChange={(e) => setLauncher({ introMessage: e.target.value })}
          className={cn(INPUT, ring(flash, 'introMessage'))}
        />
        <div className={HINT}>{t('introHint')}</div>
      </div>
      <div>
        <label htmlFor="wgt-f-subHeader" className={LABEL}>
          {t('subHeader')}
        </label>
        <input
          id="wgt-f-subHeader"
          type="text"
          value={s.launcher.subHeader}
          maxLength={LAUNCHER_LIMITS.subHeader}
          onChange={(e) => setLauncher({ subHeader: e.target.value })}
          className={cn(INPUT, 'border-border')}
        />
        <div className={HINT}>
          {t('subHeaderHint')} {s.launcher.subHeader.length}/{LAUNCHER_LIMITS.subHeader}
        </div>
      </div>
      <div>
        <label htmlFor="wgt-f-ctaText" className={LABEL}>
          {t('cta')} <span className="text-danger">*</span>
        </label>
        <input
          id="wgt-f-ctaText"
          type="text"
          value={s.launcher.ctaText}
          maxLength={LAUNCHER_LIMITS.cta}
          aria-invalid={flash === 'ctaText' || undefined}
          onChange={(e) => setLauncher({ ctaText: e.target.value })}
          className={cn(INPUT, ring(flash, 'ctaText'))}
        />
        <div className={HINT}>
          {t('ctaHint')} {s.launcher.ctaText.length}/{LAUNCHER_LIMITS.cta}
        </div>
      </div>
      {bot ? (
        <div>
          <label htmlFor="wgt-f-prefilledMessage" className={LABEL}>
            {t('prefilled')} <span className="text-danger">*</span>
          </label>
          <textarea
            id="wgt-f-prefilledMessage"
            rows={3}
            value={s.prefilledMessage}
            maxLength={BOT_MESSAGE_MAX}
            aria-invalid={flash === 'prefilledMessage' || undefined}
            onChange={(e) => set({ prefilledMessage: e.target.value })}
            className={cn(INPUT, ring(flash, 'prefilledMessage'))}
          />
          <div className={HINT}>
            {t('prefilledHint')} {s.prefilledMessage.length}/{BOT_MESSAGE_MAX}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The most a tap on a WhatsApp bot's button sends. */
export const BOT_MESSAGE_MAX = 200;

// --- card 6: the popup message ----------------------------------------------------------------------------------------------

function PopupCard({
  s,
  setLauncher,
  flash,
  upload,
}: {
  s: BuilderState;
  setLauncher: LauncherSetter;
  flash: string | null;
  upload: ((file: File) => Promise<string>) | undefined;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.card.6');
  const popup = s.launcher.popup;
  const setPopup = (patch: Partial<typeof popup>) => setLauncher({ popup: { ...popup, ...patch } });
  return (
    <div className="space-y-5">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted">
        <span>
          <span className="block text-[13px] font-semibold">{t('visibility')}</span>
          <span className="block text-[11px] text-muted-foreground">{t('visibilityHint')}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          id="wgt-f-popupEnabled"
          aria-label={t('visibility')}
          checked={popup.enabled}
          onChange={(e) => setPopup({ enabled: e.target.checked })}
          className="size-4 accent-emerald-600"
        />
      </label>
      <fieldset>
        <legend className={LABEL}>{t('position')}</legend>
        <div className="flex gap-2">
          {POPUP_POSITIONS.map((pos) => (
            <label
              key={pos}
              data-popup-position={pos}
              className={cn(
                'cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition focus-within:ring-2 focus-within:ring-primary',
                popup.position === pos
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name="wgt-popup-position"
                value={pos}
                checked={popup.position === pos}
                onChange={() => setPopup({ position: pos })}
                className="sr-only"
              />
              {t(pos)}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="wgt-f-popupText" className={LABEL}>
          {t('text')} {popup.enabled ? <span className="text-danger">*</span> : null}
        </label>
        <textarea
          id="wgt-f-popupText"
          rows={2}
          value={popup.text}
          maxLength={LAUNCHER_LIMITS.popupText}
          placeholder={DEFAULT_POPUP_TEXT}
          aria-invalid={flash === 'popupText' || undefined}
          onChange={(e) => setPopup({ text: e.target.value })}
          className={cn(INPUT, ring(flash, 'popupText'))}
        />
        <div className={HINT}>{t('textHint')}</div>
      </div>
      <div>
        <label htmlFor="wgt-f-popupImage" className={LABEL}>
          {t('image')}
        </label>
        <input
          id="wgt-f-popupImage"
          type="url"
          inputMode="url"
          value={popup.image}
          maxLength={LAUNCHER_LIMITS.avatar}
          placeholder="https://example.com/picture.png"
          aria-invalid={flash === 'popupImage' || undefined}
          onChange={(e) => setPopup({ image: e.target.value })}
          className={cn(INPUT, ring(flash, 'popupImage'))}
        />
        <div className={HINT}>{t('imageHint')}</div>
        <ImageUpload
          id="wgt-f-popupImageFile"
          value={popup.image}
          upload={upload}
          onChange={(v) => setPopup({ image: v })}
        />
      </div>
    </div>
  );
}

// --- card 4: position -------------------------------------------------------------------------------------------------------

function SideRadios({
  name,
  value,
  onChange,
}: {
  name: string;
  value: LauncherSide;
  onChange: (side: LauncherSide) => void;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.card.4');
  return (
    <div className="flex gap-2">
      {LAUNCHER_SIDES.map((side) => (
        <label
          key={side}
          data-side={`${name}-${side}`}
          className={cn(
            'cursor-pointer rounded-full border px-4 py-1.5 text-[12.5px] font-semibold transition focus-within:ring-2 focus-within:ring-primary',
            value === side
              ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
              : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          <input
            type="radio"
            name={`wgt-side-${name}`}
            value={side}
            checked={value === side}
            onChange={() => onChange(side)}
            className="sr-only"
          />
          {t(side)}
        </label>
      ))}
    </div>
  );
}

function SpacingInput({
  field,
  label,
  value,
  onChange,
  flash,
}: {
  field: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  flash: string | null;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.card.4');
  return (
    <div>
      <label htmlFor={`wgt-f-${field}`} className={LABEL}>
        {label}
      </label>
      <div className="relative">
        <input
          id={`wgt-f-${field}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={LAUNCHER_LIMITS.spacing}
          step={1}
          value={value}
          aria-invalid={flash === field || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cn(INPUT, 'pe-10', ring(flash, field))}
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">
          {t('px')}
        </span>
      </div>
    </div>
  );
}

function PositionCard({
  s,
  setPlacement,
  flash,
  device,
  onDevice,
}: {
  s: BuilderState;
  setPlacement: (device: 'desktop' | 'mobile', patch: Partial<PlacementDraft>) => void;
  flash: string | null;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.card.4');
  const l = s.launcher;
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className={LABEL}>{t('preview')}</legend>
        <div className="flex gap-2">
          {(['desktop', 'mobile'] as const).map((d) => (
            <label
              key={d}
              data-preview-device={d}
              className={cn(
                'cursor-pointer rounded-full border px-4 py-1.5 text-[12.5px] font-semibold transition focus-within:ring-2 focus-within:ring-primary',
                device === d
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name="wgt-preview-device"
                value={d}
                checked={device === d}
                onChange={() => onDevice(d)}
                className="sr-only"
              />
              {t(`${d}Preview`)}
            </label>
          ))}
        </div>
      </fieldset>

      {(['desktop', 'mobile'] as const).map((d) => (
        <div key={d} data-placement={d} className="space-y-4">
          <fieldset>
            <legend className={LABEL}>{t(`${d}Position`)}</legend>
            <SideRadios name={d} value={l[d].side} onChange={(side) => setPlacement(d, { side })} />
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SpacingInput
              field={`${d}SideSpacing`}
              label={t(`${d}SideSpacing`)}
              value={l[d].sideSpacing}
              onChange={(v) => setPlacement(d, { sideSpacing: v })}
              flash={flash}
            />
            <SpacingInput
              field={`${d}BottomSpacing`}
              label={t(`${d}BottomSpacing`)}
              value={l[d].bottomSpacing}
              onChange={(v) => setPlacement(d, { bottomSpacing: v })}
              flash={flash}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- card 5: the number -----------------------------------------------------------------------------------------------------

function NumberCard({
  s,
  set,
  flash,
  defaultIso,
}: {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  flash: string | null;
  defaultIso: string | null | undefined;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.card.5');
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="wgt-f-phone" className={LABEL}>
          {t('number')} <span className="text-danger">*</span>
        </label>
        <PhoneField
          id="wgt-f-phone"
          cc={s.targetWhatsappCc}
          number={s.targetWhatsappNumber}
          defaultIso={defaultIso}
          onCc={(cc) => set({ targetWhatsappCc: cc })}
          onNumber={(digits) => set({ targetWhatsappNumber: digits })}
          invalid={flash === 'phone'}
        />
        <div className={HINT}>{t('numberHint')}</div>
      </div>
      <div>
        <label htmlFor="wgt-f-prefilledMessage" className={LABEL}>
          {t('prefilled')}
        </label>
        <textarea
          id="wgt-f-prefilledMessage"
          rows={3}
          value={s.prefilledMessage}
          maxLength={WIDGET_LIMITS.longText}
          onChange={(e) => set({ prefilledMessage: e.target.value })}
          className={cn(INPUT, 'border-border')}
        />
        <div className={HINT}>{t('prefilledHint')}</div>
      </div>
    </div>
  );
}
