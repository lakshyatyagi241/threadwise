'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@crm/ui';

const TOPICS = ['levels', 'modes', 'customers', 'secrets'] as const;

/** A short explanation of how the pieces relate; collapsed by default so it never pushes the table down. */
export function HelpPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const t = useTranslations('whatsapp-providers.help');
  return (
    <Card className="p-0">
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>{t('title')}</span>
          <span
            aria-hidden
            className="text-muted-foreground transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90"
          >
            ›
          </span>
        </summary>
        <div className="grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-2">
          {TOPICS.map((k) => (
            <section key={k} className="space-y-1">
              <h3 className="text-sm font-semibold">{t(`${k}.title`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`${k}.body`)}</p>
            </section>
          ))}
        </div>
      </details>
    </Card>
  );
}
