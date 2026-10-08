'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button, Card, cn } from '@crm/ui';
import { setTheme } from '@/components/shell/actions';
import { showFlash } from '@/features/auth-registration-security/shared/flash';

const NS = 'admin-console-shell.workspaceSettings.appearance';
const CHOICES = ['light', 'dark'] as const;
type Choice = (typeof CHOICES)[number];

/**
 * WD-ASHELL-046: the person's own theme. It saves the same preference the header switcher does (one cookie, so the two
 * cannot disagree, which WaDesk's two separate stores could); the page reloads its data so the change shows at once.
 */
export function AppearanceTab() {
  const t = useTranslations(NS);
  const router = useRouter();
  const [value, setValue] = useState<Choice>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : 'light',
  );
  const [pending, start] = useTransition();
  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="font-serif text-xl">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </div>
      <div role="radiogroup" aria-label={t('title')} className="grid gap-3 sm:grid-cols-2">
        {CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            onClick={() => setValue(c)}
            className={cn(
              'rounded-xl border p-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary',
              value === c ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
            )}
          >
            <span className="block text-sm font-semibold">{t(`choices.${c}.label`)}</span>
            <span className="block text-xs text-muted-foreground">{t(`choices.${c}.body`)}</span>
          </button>
        ))}
      </div>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setTheme(value);
            showFlash(t('saved'));
            router.refresh();
          })
        }
      >
        {t('save')}
      </Button>
    </Card>
  );
}
