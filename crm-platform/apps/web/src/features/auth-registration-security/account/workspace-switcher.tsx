'use client';

import { ERROR_CODES } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Spinner, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { retryAfterSeconds } from '../shared/error-utils';
import { showFlash } from '../shared/flash';
import { ChevronDownIcon, CheckIcon } from '../shared/icons';
import { useSession } from '../shared/session-context';
import { authApi, bffPost, bffSwitchResultSchema, keys } from './api';
import { MfaChallengeModal } from './mfa-challenge-modal';

interface Target {
  slug: string;
  name: string;
}

/**
 * Workspace switcher in the header (WD-AUTH-010). Hidden (just the current
 * name) when the person only belongs to one workspace. Switching asks the
 * server for a session in the other workspace; if that account has two-factor
 * on, a code prompt appears first.
 */
export function WorkspaceSwitcher() {
  const t = useTranslations('auth-registration-security.account.switcher');
  const { org } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: keys.workspaces,
    queryFn: authApi.workspaces,
    staleTime: 60_000,
    retry: false,
  });

  const [open, setOpen] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{ token: string; target: Target } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const workspaces = list.data?.data ?? [];

  // Close on an outside press, and put focus on the current item when it opens.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    const menu = menuRef.current;
    (
      menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>('[role="menuitemradio"]')
    )?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  if (workspaces.length < 2) {
    return <span className="truncate text-sm font-medium">{org.name}</span>;
  }

  function finish(target: Target) {
    // Everything cached so far belongs to the workspace we just left.
    queryClient.clear();
    showFlash(t('switched', { name: target.name }));
    router.replace('/');
    router.refresh();
  }

  function fail(error: unknown) {
    const wait = retryAfterSeconds(error);
    const message =
      error instanceof ApiError && error.code === ERROR_CODES.AUTH_WORKSPACE_NOT_AVAILABLE
        ? t('notAvailable')
        : error instanceof ApiError && error.code === ERROR_CODES.RATE_LIMITED
          ? wait
            ? t('rateLimitedWait', { seconds: wait })
            : t('rateLimited')
          : t('failed');
    showFlash(message, 'danger');
  }

  async function choose(target: Target) {
    setOpen(false);
    if (pendingSlug) return;
    setPendingSlug(target.slug);
    try {
      const result = await bffPost('switch', { orgSlug: target.slug }, bffSwitchResultSchema);
      if (result.status === 'mfa_required') {
        setChallenge({ token: result.challengeToken, target });
      } else {
        finish(target);
      }
    } catch (error) {
      fail(error);
    } finally {
      setPendingSlug(null);
    }
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items.at(-1)?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const switching = pendingSlug !== null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('label', { name: org.name })}
        disabled={switching}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[14rem] items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 sm:max-w-xs"
      >
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/15 text-xs font-semibold text-primary"
        >
          {org.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate font-medium">{org.name}</span>
        {switching ? (
          <Spinner label={t('switching')} />
        ) : (
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('heading')}
          onKeyDown={onMenuKey}
          className="absolute start-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background p-1 shadow-lg"
        >
          <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('heading')}
          </div>
          {workspaces.map((w) => (
            <button
              key={w.slug}
              type="button"
              role="menuitemradio"
              aria-checked={w.current}
              onClick={() =>
                w.current ? setOpen(false) : void choose({ slug: w.slug, name: w.name })
              }
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-2 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                w.current && 'font-medium',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{w.name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground" dir="ltr">
                  {w.slug}
                </span>
              </span>
              {w.current && <CheckIcon className="size-4 text-primary" />}
            </button>
          ))}
        </div>
      )}

      {challenge && (
        <MfaChallengeModal
          challengeToken={challenge.token}
          workspaceName={challenge.target.name}
          onClose={() => setChallenge(null)}
          onSuccess={() => {
            const target = challenge.target;
            setChallenge(null);
            finish(target);
          }}
        />
      )}
    </div>
  );
}
