'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Input, Select } from '@crm/ui';
import {
  DEFAULT_POPUP,
  POPUP_LIMITS,
  POPUP_POSITIONS,
  POPUP_TRIGGERS,
  clampWhole,
  popupButtonSnippet,
  popupSnippet,
  type PopupOptions,
  type PopupPosition,
  type PopupTrigger,
} from '../lib/popup';
import type { FormDetail } from '../lib/types';
import { Block, Snippet } from './share-tab';

const HINT = 'text-xs text-muted-foreground';

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5 text-sm">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

/**
 * "Show as a popup" (Share tab): pick when the form opens in a dialog on the owner's own website (after a delay, on scrolling down, on
 * scrolling back up, or on a click) and copy the code. The options live in the pasted code, not on the form, so this block is a code
 * generator and saves nothing.
 */
export function PopupEmbed({ form }: { form: FormDetail }) {
  const t = useTranslations('web-forms.popup');
  const [o, setO] = useState<PopupOptions>(DEFAULT_POPUP);
  const set = (patch: Partial<PopupOptions>) => setO((cur) => ({ ...cur, ...patch }));
  const code = popupSnippet({
    key: form.publicKey,
    scriptUrl: form.share.embedScriptUrl,
    title: form.name,
    options: o,
  });

  return (
    <Block title={t('title')} description={t('description')}>
      <div className="grid gap-4 sm:grid-cols-2" data-testid="popup-options">
        <Labelled label={t('trigger')} hint={t(`triggerHints.${o.trigger}`)}>
          {(id) => (
            <Select
              id={id}
              value={o.trigger}
              onChange={(e) => set({ trigger: e.target.value as PopupTrigger })}
            >
              {POPUP_TRIGGERS.map((x) => (
                <option key={x} value={x}>
                  {t(`triggers.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Labelled>
        {o.trigger === 'delay' && (
          <Labelled label={t('delay')} hint={t('delayHint', POPUP_LIMITS.delay)}>
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="numeric"
                className="max-w-32"
                value={String(o.delay)}
                onChange={(e) => set({ delay: clampWhole(e.target.value, POPUP_LIMITS.delay) })}
              />
            )}
          </Labelled>
        )}
        {o.trigger === 'scroll_down' && (
          <Labelled label={t('scroll')} hint={t('scrollHint', POPUP_LIMITS.scroll)}>
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="numeric"
                className="max-w-32"
                value={String(o.scroll)}
                onChange={(e) => set({ scroll: clampWhole(e.target.value, POPUP_LIMITS.scroll) })}
              />
            )}
          </Labelled>
        )}
        <Labelled label={t('position')}>
          {(id) => (
            <Select
              id={id}
              value={o.position}
              onChange={(e) => set({ position: e.target.value as PopupPosition })}
            >
              {POPUP_POSITIONS.map((x) => (
                <option key={x} value={x}>
                  {t(`positions.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Labelled>
        <Labelled label={t('days')} hint={t('daysHint')}>
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              inputMode="numeric"
              className="max-w-32"
              value={String(o.days)}
              onChange={(e) => set({ days: clampWhole(e.target.value, POPUP_LIMITS.days) })}
            />
          )}
        </Labelled>
      </div>
      <p className={HINT}>{t('note')}</p>
      <Snippet
        title={t('code.title')}
        description={t('code.description')}
        code={code}
        copyLabel={t('copy')}
      />
      <Snippet
        title={t('button.title')}
        description={t('button.description')}
        code={popupButtonSnippet(form.publicKey)}
        copyLabel={t('copy')}
      />
    </Block>
  );
}
