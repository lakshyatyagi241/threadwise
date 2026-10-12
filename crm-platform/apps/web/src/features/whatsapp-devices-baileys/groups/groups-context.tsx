'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PersonalDevice } from '@crm/contracts';
import { useErrorText } from '../components/use-error-text';
import type { GroupNotice, GroupPerms } from './groups-model';

/** What every row, modal and panel of the Groups tab needs about the number on show. */
export interface GroupsCtx {
  device: PersonalDevice;
  /** The number is connected: anything that reaches WhatsApp may be tried. */
  online: boolean;
  perms: GroupPerms;
  /** Seconds the number's group actions are held back after a rate limit (0: not held). */
  waitSeconds: number;
  notify: (n: GroupNotice) => void;
  /** Turns a failed call into a notice; a rate limit also starts the countdown. */
  fail: (err: unknown) => void;
}

const Ctx = createContext<GroupsCtx | null>(null);

export function GroupsProvider({ value, children }: { value: GroupsCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGroupsCtx(): GroupsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('GroupsProvider is missing');
  return v;
}

/**
 * The hold after a rate limit: `hold(seconds)` from a refusal, `holdUntil(iso)` from the state endpoint's `cooldownUntil`. The remaining
 * seconds count down on their own (one tick a second, only while a hold runs) and reach 0 when the hold is over.
 */
export function useHold(): {
  waitSeconds: number;
  hold: (seconds: number) => void;
  holdUntil: (iso: string | null | undefined) => void;
} {
  const [clock, setClock] = useState<{ until: number; now: number } | null>(null);
  const until = clock?.until ?? null;
  useEffect(() => {
    if (until === null) return;
    const id = setInterval(() => {
      const now = Date.now();
      setClock((c) => (c ? { ...c, now } : c));
      if (now >= until) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);
  const waitSeconds = clock ? Math.max(0, Math.ceil((clock.until - clock.now) / 1000)) : 0;
  return {
    waitSeconds,
    hold: (seconds) => {
      const now = Date.now();
      setClock({ until: now + Math.max(1, seconds) * 1000, now });
    },
    holdUntil: (iso) => {
      const at = iso ? Date.parse(iso) : NaN;
      const now = Date.now();
      if (Number.isFinite(at) && at > now) {
        setClock((c) => (c && c.until >= at ? c : { until: at, now }));
      }
    },
  };
}

/** `fail` and `notify` for a screen that keeps the notice and the hold. */
export function useFailHandler(
  setNotice: (n: GroupNotice) => void,
  hold: (seconds: number) => void,
): (err: unknown) => void {
  const errorText = useErrorText();
  return (err) => {
    const et = errorText(err);
    if (et.code === 'WA_GROUP_RATE_LIMITED' && et.retryAfterS) hold(et.retryAfterS);
    setNotice({ tone: 'danger', text: et.text, requestId: et.requestId });
  };
}
