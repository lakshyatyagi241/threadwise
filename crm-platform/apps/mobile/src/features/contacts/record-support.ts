import { ERROR_CODES } from '@crm/contracts';
import * as Crypto from 'expo-crypto';
import { useRef } from 'react';
import { isApiError } from '@/lib/api';

/**
 * One idempotency key per user action. Only a lost connection keeps the key (the tap on "Save" is repeated as the same request);
 * any answer from the server ends the action, so a corrected form is a new one.
 */
export function useActionKey() {
  const key = useRef(Crypto.randomUUID());
  const renew = () => void (key.current = Crypto.randomUUID());
  return {
    current: () => key.current,
    renew,
    failed: (error: unknown) => {
      if (!(isApiError(error) && error.isConnectivity)) renew();
    },
  };
}

/** What a failed read means for the screen: the contact is gone, the person may not see it, or something else went wrong. */
export type FailureKind = 'missing' | 'denied' | 'other';

export function failureKindOf(error: unknown): FailureKind {
  if (!isApiError(error)) return 'other';
  if (error.code === ERROR_CODES.NOT_FOUND) return 'missing';
  if (error.code === ERROR_CODES.FORBIDDEN || error.status === 403) return 'denied';
  return 'other';
}

/** A route parameter as one string: expo-router gives an array when the name is repeated in the URL. */
export const firstParam = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/** Pieces of a caption on one line ("Oct 12, 2026, 3:30 PM · Edited"); the ones that are empty are left out. */
export const joinMeta = (parts: ReadonlyArray<string | null | undefined>): string =>
  parts.filter(Boolean).join(' · ');
