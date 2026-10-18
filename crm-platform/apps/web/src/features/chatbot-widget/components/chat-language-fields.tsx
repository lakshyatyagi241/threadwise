'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CHAT_LANGUAGES_MAX, type WidgetChatOptions } from '@crm/contracts';
import { cn } from '@crm/ui';
import { LOCALES } from '@/i18n/locales';

const INPUT =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-brand';
const CAPTION =
  'mb-2 block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground';

/** A language's name in the author's own language (the code itself when the browser does not know it). */
function nameOf(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The languages the chat window speaks: its primary language (or none, which follows the visitor's browser), and the other languages
 * a visitor's browser may switch it to. A code the app does not list (one brought over from another system) stays selectable.
 */
export function ChatLanguageFields({
  value,
  onChange,
}: {
  value: WidgetChatOptions['languages'];
  onChange: (next: WidgetChatOptions['languages']) => void;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize.brand.languages');
  const locale = useLocale();
  const known: string[] = [...LOCALES];
  const options = [...new Set([...known, value.primary, ...value.additional].filter(Boolean))];
  const others = options.filter((c) => c !== value.primary);
  return (
    <div className="space-y-3" data-testid="chat-languages">
      <div>
        <label htmlFor="wgt-f-lang-primary" className={CAPTION}>
          {t('primary')}
        </label>
        <select
          id="wgt-f-lang-primary"
          value={value.primary}
          onChange={(e) =>
            onChange({
              primary: e.target.value,
              additional: value.additional.filter((c) => c !== e.target.value),
            })
          }
          className={cn(INPUT, 'max-w-xs')}
        >
          <option value="">{t('follow')}</option>
          {options.map((c) => (
            <option key={c} value={c}>
              {nameOf(c, locale)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{t('primaryHint')}</p>
      </div>
      {value.primary ? (
        <fieldset>
          <legend className={CAPTION}>{t('additional')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {others.map((c) => {
              const on = value.additional.includes(c);
              return (
                <label key={c} className="flex items-center gap-1.5 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && value.additional.length >= CHAT_LANGUAGES_MAX}
                    onChange={() =>
                      onChange({
                        ...value,
                        additional: on
                          ? value.additional.filter((x) => x !== c)
                          : [...value.additional, c],
                      })
                    }
                  />
                  {nameOf(c, locale)}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">{t('additionalHint')}</p>
        </fieldset>
      ) : null}
    </div>
  );
}
