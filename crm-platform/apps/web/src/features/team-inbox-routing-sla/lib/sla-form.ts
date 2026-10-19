import {
  CONVERSATION_PRIORITIES,
  SLA_FIRST_RESPONSE_MAX_MINUTES,
  SLA_RESOLUTION_MAX_MINUTES,
  type CreateInboxSlaPolicyInput,
  type InboxSlaPolicy,
} from '@crm/contracts';

/** The policy form as text boxes: minutes are typed, so they are strings until they are checked. */
export interface SlaDraft {
  name: string;
  firstResponse: string;
  resolution: string;
  businessHours: boolean;
  isDefault: boolean;
  /** Per priority: [first reply, resolve] text boxes. */
  overrides: Record<string, [string, string]>;
}

export const emptyDraft = (isFirst: boolean): SlaDraft => ({
  name: '',
  firstResponse: '',
  resolution: '',
  businessHours: true,
  isDefault: isFirst,
  overrides: Object.fromEntries(CONVERSATION_PRIORITIES.map((p) => [p, ['', '']])),
});

export function draftOf(p: InboxSlaPolicy): SlaDraft {
  return {
    name: p.name,
    firstResponse: p.firstResponseMinutes === null ? '' : String(p.firstResponseMinutes),
    resolution: p.resolutionMinutes === null ? '' : String(p.resolutionMinutes),
    businessHours: p.respectBusinessHours,
    isDefault: p.isDefault,
    overrides: Object.fromEntries(
      CONVERSATION_PRIORITIES.map((k) => {
        const o = p.priorityOverrides[k];
        return [
          k,
          [o?.firstResponseMinutes?.toString() ?? '', o?.resolutionMinutes?.toString() ?? ''],
        ];
      }),
    ),
  };
}

/** `''` is "no target" (null); a whole number in range is that number; anything else is invalid (undefined). */
export function minutesOf(text: string, max: number): number | null | undefined {
  const s = text.trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 && n <= max ? n : undefined;
}

export type DraftResult =
  | { ok: true; value: Omit<CreateInboxSlaPolicyInput, never> }
  | { ok: false; problem: 'name' | 'minutes' };

/** The request body for the draft, or what is wrong with it. */
export function toInput(d: SlaDraft): DraftResult {
  const name = d.name.trim();
  if (name === '') return { ok: false, problem: 'name' };
  const first = minutesOf(d.firstResponse, SLA_FIRST_RESPONSE_MAX_MINUTES);
  const resolution = minutesOf(d.resolution, SLA_RESOLUTION_MAX_MINUTES);
  if (first === undefined || resolution === undefined) return { ok: false, problem: 'minutes' };
  const overrides: Record<string, { firstResponseMinutes?: number; resolutionMinutes?: number }> =
    {};
  for (const p of CONVERSATION_PRIORITIES) {
    const [f, r] = d.overrides[p] ?? ['', ''];
    const fm = minutesOf(f, SLA_FIRST_RESPONSE_MAX_MINUTES);
    const rm = minutesOf(r, SLA_RESOLUTION_MAX_MINUTES);
    if (fm === undefined || rm === undefined) return { ok: false, problem: 'minutes' };
    if (fm !== null || rm !== null) {
      overrides[p] = {
        ...(fm !== null ? { firstResponseMinutes: fm } : {}),
        ...(rm !== null ? { resolutionMinutes: rm } : {}),
      };
    }
  }
  return {
    ok: true,
    value: {
      name,
      firstResponseMinutes: first,
      resolutionMinutes: resolution,
      respectBusinessHours: d.businessHours,
      priorityOverrides: overrides,
      isDefault: d.isDefault,
    },
  };
}
