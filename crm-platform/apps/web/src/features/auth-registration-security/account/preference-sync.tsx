'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { setLocale, setTheme } from '@/components/shell/actions';
import { useSession } from '../shared/session-context';
import { preferencesToApply } from './preferences';

/**
 * Applies the theme and language stored on the profile when this browser has no
 * theme / language cookie yet (a new browser, a cleared cookie jar), so a person
 * signing in somewhere new sees the app the way they set it up. The shell reads
 * only those two cookies; this sets them through the shell's own server actions
 * and refreshes once if the language changed. Renders nothing.
 */
export function PreferenceSync() {
  const { user } = useSession();
  const router = useRouter();
  const { theme, locale } = user;

  useEffect(() => {
    const todo = preferencesToApply(document.cookie, { theme, locale });
    if (!todo.theme && !todo.locale) return;
    const jobs: Array<Promise<unknown>> = [];
    if (todo.theme) {
      document.documentElement.dataset.theme = todo.theme;
      jobs.push(setTheme(todo.theme));
    }
    if (todo.locale) jobs.push(setLocale(todo.locale));
    const reload = Boolean(todo.locale);
    void Promise.all(jobs).then(() => {
      if (reload) router.refresh();
    });
  }, [theme, locale, router]);

  return null;
}
