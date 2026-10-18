'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type {
  ContactTouchChannel,
  LeadHandlingSettings,
  UncontactedSettings,
  UpdateUncontactedSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import type { BulkTarget } from '../lib/selection';
import { run } from './bulk';

/**
 * Lead handling (BL-290..292): the workspace's uncontacted-lead, follow-up and duplicate-lead settings, and the actions that move a
 * contact's "Uncontacted" marker. The contracts type responses as interfaces, so the boundary check is the fields each screen reads.
 */

const shape = <T>(...required: string[]): z.ZodType<T, z.ZodTypeDef, unknown> =>
  z.custom<T>(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      required.every((k) => k in (v as Record<string, unknown>)),
    'Unexpected response',
  );

const settingsShape = shape<LeadHandlingSettings>('uncontacted');
const uncontactedShape = shape<UncontactedSettings>(
  'clearOn',
  'markNew',
  'onReassign',
  'rowVersion',
);
const markShape = z.object({ uncontacted: z.boolean() });

export const LEAD_HANDLING_KEYS = {
  settings: ['lead-handling', 'settings'] as const,
};

export const leadHandlingApi = {
  settings: (signal?: AbortSignal) =>
    apiFetch('/lead-handling/settings', { schema: settingsShape, signal }),
  saveUncontacted: (input: UpdateUncontactedSettingsInput) =>
    apiFetch('/lead-handling/settings/uncontacted', {
      method: 'PUT',
      body: input,
      schema: uncontactedShape,
    }),
};

/** The settings screens' read. Only people who manage workspace settings can read it (`admin.settings.manage`). */
export function useLeadHandlingSettings(enabled: boolean) {
  return useQuery({
    queryKey: LEAD_HANDLING_KEYS.settings,
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => leadHandlingApi.settings(signal),
  });
}

/** One contact marked by hand: `true` uncontacted, `false` contacted. */
export const setUncontacted = (contactId: string, uncontacted: boolean) =>
  apiFetch(`/contacts/${contactId}/uncontacted`, {
    method: 'PUT',
    body: { uncontacted },
    schema: markShape,
  });

/**
 * The person pressed Call, SMS, E-mail or WhatsApp. Reported quietly: it never blocks the button and a failure is not shown (the
 * workspace's settings decide whether anything happens at all).
 */
export function reportContactTouch(
  contactId: string,
  channel: ContactTouchChannel,
  /** Runs when the marker really moved (the contact screens refresh their data then). */
  onCleared?: () => void,
): void {
  apiFetch(`/contacts/${contactId}/touch`, {
    method: 'POST',
    body: { channel },
    schema: markShape,
  })
    .then((r) => {
      if (!r.uncontacted) onCleared?.();
    })
    .catch(() => undefined);
}

/** A selection (ticked rows, or everything the view matches) marked by hand. */
export const bulkSetUncontacted = (target: BulkTarget, uncontacted: boolean) =>
  run('/contacts/bulk/uncontacted', target, { uncontacted });
