import { WABA_GROUP_REMOVE_MAX, type WabaConnection } from '@crm/contracts';

export type GroupNotice = {
  tone: 'success' | 'warning' | 'danger';
  text: string;
  requestId?: string;
};

/**
 * The number a Groups page shows: the one named in `?account=` when it is a connected number of this workspace, else the first connected
 * one (Reference's rule). Disconnected numbers are not offered: Meta cannot be asked through them.
 */
export function pickAccount(
  numbers: readonly WabaConnection[],
  accountId: string | undefined,
): WabaConnection | null {
  const connected = numbers.filter((n) => n.status === 'connected');
  return connected.find((n) => n.id === accountId) ?? connected[0] ?? null;
}

/** Which message block the state endpoint's reason draws instead of the controls. `null`: the page works (eligible, or Meta could not be asked). */
export function blockedView(
  reason: string,
): 'notEligible' | 'providerUnsupported' | 'missingCredentials' | null {
  if (reason === 'not_eligible') return 'notEligible';
  if (reason === 'provider_unsupported') return 'providerUnsupported';
  if (reason === 'missing_credentials' || reason === 'not_connected') return 'missingCredentials';
  return null;
}

/** Ticks one more member for removal, never past Meta's 8 per request. */
export function toggleSelected(selected: readonly string[], waId: string): string[] {
  if (selected.includes(waId)) return selected.filter((s) => s !== waId);
  return selected.length >= WABA_GROUP_REMOVE_MAX ? [...selected] : [...selected, waId];
}

/** The fields of the edit form that differ from the group, ready for the PATCH body; null when nothing changed or the name is blank. */
export function editPatch(
  current: { subject: string | null; description: string | null },
  draft: { subject: string; description: string },
): { subject?: string; description?: string } | null {
  const subject = draft.subject.trim();
  const description = draft.description.trim();
  if (!subject) return null;
  const patch: { subject?: string; description?: string } = {};
  if (subject !== (current.subject ?? '')) patch.subject = subject;
  if (description !== (current.description ?? '')) patch.description = description;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Copies text; falls back to a hidden textarea where the Clipboard API needs a secure context (Reference's behaviour on plain HTTP). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
