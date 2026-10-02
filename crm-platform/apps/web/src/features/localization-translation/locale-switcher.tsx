'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { activeLanguagesResponseSchema, setMyLocaleResponseSchema } from '@crm/contracts';
import { Menu, MenuRadioItem } from '@crm/ui';
import { setLocale } from '@/components/shell/actions';
import { apiFetch } from '@/lib/api/client';
import { hasChoice, switchLocale, triggerCode } from './locale-switch';

/**
 * TW-I18N-010: the globe dropdown (current code, native name, English name, code). It lists the ACTIVE languages from the
 * registry, saves a signed-in user's pick on the server and always sets the session cookie, then refreshes in place.
 * Drop it into any header: it renders nothing when there is no choice to make.
 */
export function LocaleSwitcher({ align = 'end' }: { align?: 'start' | 'end' }) {
  const t = useTranslations('localization-translation.switcher');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const q = useQuery({
    queryKey: ['i18n', 'active-languages'],
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/i18n/languages', { schema: activeLanguagesResponseSchema, signal }),
  });
  const active = q.data?.data ?? [];
  if (!hasChoice(active)) return null;

  const pick = (code: string) =>
    start(async () => {
      const result = await switchLocale(code, {
        saveMine: (c) =>
          apiFetch('/me/locale', {
            method: 'PATCH',
            body: { code: c },
            schema: setMyLocaleResponseSchema,
          }),
        setCookie: setLocale,
      });
      setFailed(result === 'failed');
      if (result === 'ok') router.refresh();
    });

  return (
    <div className="inline-flex flex-col items-end">
      <Menu
        label={t('menu')}
        align={align}
        disabled={pending}
        className="w-56"
        triggerClassName="h-8 gap-1.5 px-2.5 text-xs"
        triggerProps={{ title: t('label'), 'aria-label': t('label') }}
        trigger={
          <>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            >
              <circle cx="8" cy="8" r="6.2" />
              <path d="M1.8 8h12.4M8 1.8c1.9 1.7 2.9 3.8 2.9 6.2S9.9 12.5 8 14.2C6.1 12.5 5.1 10.4 5.1 8S6.1 3.5 8 1.8z" />
            </svg>
            <span className="font-mono uppercase">{triggerCode(active, locale)}</span>
            <svg
              viewBox="0 0 12 12"
              aria-hidden="true"
              className="size-2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M3 4.5l3 3 3-3" />
            </svg>
          </>
        }
      >
        {active.map((l) => (
          <MenuRadioItem
            key={l.code}
            checked={l.code === locale}
            onSelect={() => pick(l.code)}
            hint={l.code}
          >
            <span dir={l.direction} className="font-medium">
              {l.nativeName ?? l.name}
            </span>{' '}
            <span className="text-xs text-muted-foreground">{l.name}</span>
          </MenuRadioItem>
        ))}
      </Menu>
      {failed && (
        <span role="alert" className="mt-1 text-xs text-danger">
          {t('failed')}
        </span>
      )}
    </div>
  );
}
