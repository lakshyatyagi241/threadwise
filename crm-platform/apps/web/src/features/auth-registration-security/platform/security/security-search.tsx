'use client';

import { useTranslations } from 'next-intl';
import { SearchIcon } from '../ui/icons';
import { SECURITY_NS } from './policy-form';

/**
 * The search box in the Security Center's header row. Like Reference's it is a placeholder for a future
 * global search: it takes focus and text and does nothing with them. Enter is swallowed so it can
 * never submit the policy form.
 */
export function SecuritySearch() {
  const t = useTranslations(`${SECURITY_NS}.search`);
  return (
    <div className="relative w-full max-w-lg" role="search">
      <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        aria-label={t('label')}
        placeholder={t('placeholder')}
        autoComplete="off"
        enterKeyHint="search"
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        className="h-9 w-full rounded-full border border-border bg-muted/40 ps-9 pe-3 text-sm outline-none focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary sm:pe-16"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline"
      >
        {t('shortcut')}
      </kbd>
    </div>
  );
}
