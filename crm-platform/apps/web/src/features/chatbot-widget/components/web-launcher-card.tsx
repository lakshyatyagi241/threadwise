'use client';

import { useTranslations } from 'next-intl';
import { LAUNCHER_ANIMATIONS, LAUNCHER_LIMITS, POPUP_STYLES, WIDGET_LIMITS } from '@crm/contracts';
import { cn } from '@crm/ui';
import type { BuilderState } from '../lib/builder-model';
import { ToggleRow } from './toggle-row';
import { ImageUpload } from './image-upload';

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-brand';
const LABEL = 'mb-1.5 block text-[11.5px] font-semibold';

/**
 * The closed launcher of a website chat bot: the callout beside it (a bubble, a pill, a pill with an avatar, a card with a picture or a
 * bar like the chat's input), its picture, the bounce or ripple that draws the eye, and the unread dot. What the visitor sees before
 * they open the chat.
 */
export function WebLauncherCard({
  s,
  set,
  upload,
}: {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  /** Keeps a picture for this bot and returns its address. */
  upload: (file: File) => Promise<string>;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize.launcher');
  const ti = useTranslations('chatbotWidget.builder.look');
  const l = s.launcher;
  const popup = l.popup;
  const setLauncher = (patch: Partial<typeof l>) => set({ launcher: { ...l, ...patch } });
  const setPopup = (patch: Partial<typeof popup>) => setLauncher({ popup: { ...popup, ...patch } });
  const pictureStyle = popup.style === 'avatar' || popup.style === 'media';
  return (
    <fieldset data-testid="web-launcher-card" className="space-y-4">
      <legend className="mb-1 text-[13px] font-semibold">{t('title')}</legend>
      <p className="-mt-2 text-[12px] text-muted-foreground">{t('hint')}</p>

      <div>
        <label
          htmlFor="wgt-f-buttonImageUrl"
          className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground"
        >
          {ti('icon')}
        </label>
        <input
          id="wgt-f-buttonImageUrl"
          type="text"
          value={s.buttonImageUrl}
          maxLength={WIDGET_LIMITS.imageUrl}
          placeholder="https://yoursite.com/logo.png"
          onChange={(e) => set({ buttonImageUrl: e.target.value })}
          className={INPUT}
        />
        <p className="mt-1 text-[11.5px] text-muted-foreground">{ti('iconHint')}</p>
      </div>

      <ToggleRow
        id="wgt-f-popupEnabled"
        checked={popup.enabled}
        label={t('calloutOn')}
        onChange={(enabled) => setPopup({ enabled })}
      />

      {popup.enabled ? (
        <>
          <div
            role="radiogroup"
            aria-label={t('style')}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {POPUP_STYLES.map((k) => (
              <label
                key={k}
                data-popup-style={k}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-[12.5px]',
                  popup.style === k ? 'border-brand bg-brand/5' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="wgt-popup-style"
                  checked={popup.style === k}
                  onChange={() => setPopup({ style: k })}
                  className="accent-[var(--brand)]"
                />
                {t(`styles.${k}`)}
              </label>
            ))}
          </div>
          <div>
            <label htmlFor="wgt-f-popupText" className={LABEL}>
              {t('text')} <span className="text-danger">*</span>
            </label>
            <input
              id="wgt-f-popupText"
              type="text"
              value={popup.text}
              maxLength={LAUNCHER_LIMITS.popupText}
              onChange={(e) => setPopup({ text: e.target.value })}
              className={INPUT}
            />
          </div>
          {pictureStyle ? (
            <div>
              <label htmlFor="wgt-f-popupImageFile" className={LABEL}>
                {t('image')}
              </label>
              <ImageUpload
                id="wgt-f-popupImageFile"
                value={popup.image}
                upload={upload}
                onChange={(v) => setPopup({ image: v })}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="wgt-f-animation" className={LABEL}>
            {t('animation')}
          </label>
          <select
            id="wgt-f-animation"
            value={l.animation}
            onChange={(e) =>
              setLauncher({ animation: e.target.value as (typeof LAUNCHER_ANIMATIONS)[number] })
            }
            className={INPUT}
          >
            {LAUNCHER_ANIMATIONS.map((a) => (
              <option key={a} value={a}>
                {t(`animations.${a}`)}
              </option>
            ))}
          </select>
        </div>
        <ToggleRow
          id="wgt-f-badge"
          checked={l.badge}
          label={t('badge')}
          onChange={(badge) => setLauncher({ badge })}
        />
      </div>

      <div className="space-y-2" data-testid="web-launcher-gaps">
        <div className="text-[11.5px] font-semibold">{t('gaps.title')}</div>
        <div className="grid grid-cols-2 gap-3">
          {(['desktop', 'mobile'] as const).flatMap((d) =>
            (['sideSpacing', 'bottomSpacing'] as const).map((k) => (
              <div key={`${d}${k}`}>
                <label
                  htmlFor={`wgt-f-${d}-${k}`}
                  className="mb-1 block text-[11.5px] text-muted-foreground"
                >
                  {t(`gaps.${d}.${k === 'sideSpacing' ? 'side' : 'bottom'}`)}
                </label>
                <input
                  id={`wgt-f-${d}-${k}`}
                  type="number"
                  min={0}
                  max={LAUNCHER_LIMITS.spacing}
                  value={l[d][k]}
                  onChange={(e) => {
                    const n = Math.min(
                      LAUNCHER_LIMITS.spacing,
                      Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                    );
                    setLauncher({ [d]: { ...l[d], [k]: String(n) } });
                  }}
                  className={INPUT}
                />
              </div>
            )),
          )}
        </div>
      </div>
    </fieldset>
  );
}
