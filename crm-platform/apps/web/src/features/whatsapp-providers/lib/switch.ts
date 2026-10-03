import type { SwitchChannelResult, SwitchResult } from '../api/schemas';

export type SwitchTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Message key (under `whatsapp-providers.switch.status`) and tone for one channel's result. */
export function resultView(status: SwitchChannelResult['status']): {
  key: string;
  tone: SwitchTone;
} {
  switch (status) {
    case 'ready':
      return { key: 'ready', tone: 'success' };
    case 'switched':
      return { key: 'switched', tone: 'success' };
    case 'warning':
      return { key: 'warning', tone: 'warning' };
    case 'blocked':
      return { key: 'blocked', tone: 'danger' };
    case 'failed':
      return { key: 'failed', tone: 'danger' };
    case 'skipped':
      return { key: 'skipped', tone: 'neutral' };
  }
}

export interface SwitchSummary {
  total: number;
  ready: number;
  warnings: number;
  blocked: number;
  switched: number;
  failed: number;
  skipped: number;
  queuedMessages: number;
}

export function summarize(results: readonly SwitchChannelResult[]): SwitchSummary {
  const s: SwitchSummary = {
    total: results.length,
    ready: 0,
    warnings: 0,
    blocked: 0,
    switched: 0,
    failed: 0,
    skipped: 0,
    queuedMessages: 0,
  };
  for (const r of results) {
    if (r.status === 'ready') s.ready += 1;
    else if (r.status === 'warning') s.warnings += 1;
    else if (r.status === 'blocked') s.blocked += 1;
    else if (r.status === 'switched') s.switched += 1;
    else if (r.status === 'failed') s.failed += 1;
    else s.skipped += 1;
    s.queuedMessages += r.queuedMessages;
  }
  return s;
}

/** A queued-messages warning needs the force option; a blocked channel (target unreachable) is never moved. */
export const needsForce = (results: readonly SwitchChannelResult[]): boolean =>
  results.some((r) => r.status === 'warning');

/** The channels the real run will move: the ready ones, plus the warned ones when force is on. */
export function movableIds(results: readonly SwitchChannelResult[], force: boolean): string[] {
  return results
    .filter((r) => r.status === 'ready' || (force && r.status === 'warning'))
    .map((r) => r.channelId);
}

/** Applying needs at least one movable channel; the typed confirmation is checked separately. */
export const canApplySwitch = (results: readonly SwitchChannelResult[], force: boolean): boolean =>
  movableIds(results, force).length > 0;

/** The confirmation is the target provider's key, typed exactly (case matters: it is an identifier). */
export const confirmationMatches = (typed: string, targetKey: string): boolean =>
  targetKey !== '' && typed.trim() === targetKey;

/** After the real run: what happened, and whether a rollback hint applies (something was moved). */
export function outcome(result: SwitchResult): {
  summary: SwitchSummary;
  kind: 'allSwitched' | 'partial' | 'noneSwitched';
  rollback: boolean;
} {
  const summary = summarize(result.results);
  const kind =
    summary.switched === 0
      ? 'noneSwitched'
      : summary.switched === summary.total
        ? 'allSwitched'
        : 'partial';
  return { summary, kind, rollback: summary.switched > 0 };
}

/** The ids that failed or were blocked in a real run, to offer "try these again". */
export const retryIds = (result: SwitchResult): string[] =>
  result.results
    .filter((r) => r.status === 'failed' || r.status === 'blocked')
    .map((r) => r.channelId);

/** The per-channel codes the API reports (`WAP_*`); an unknown one reads as `unknown` with the raw code beside it. */
const CODE_KEYS: Record<string, string> = {
  WAP_SWITCH_NOOP: 'noop',
  WAP_CHANNEL_INCOMPLETE: 'incomplete',
  WAP_SWITCH_UNREACHABLE: 'unreachable',
  WAP_SWITCH_QUEUE_BUSY: 'queueBusy',
  WAP_CHANNEL_NOT_WHATSAPP: 'notWhatsapp',
  WAP_PROVIDER_DISABLED: 'disabled',
  WAP_CREDENTIALS_MISSING: 'credentialsMissing',
};

export const SWITCH_CODE_KEYS = [...new Set(Object.values(CODE_KEYS)), 'unknown'] as const;

/** Message key (under `whatsapp-providers.switch.codes`) for a channel result's code. */
export const switchCodeKey = (code: string | null | undefined): string =>
  (code && CODE_KEYS[code]) || 'unknown';
