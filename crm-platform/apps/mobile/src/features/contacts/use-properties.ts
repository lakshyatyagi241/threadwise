import { ERROR_CODES } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import type { TFunction } from 'i18next';
import { useRef } from 'react';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import {
  listAssignees,
  listContactFieldDependencies,
  listContactFields,
  listContactStatusOptions,
  listFieldOptions,
  setContactAssignee,
} from './properties-api';
import { contactKey, contactsKey } from './use-contacts';

/**
 * The property definitions, status options and assignable people change rarely and are the same for every contact, so they are
 * kept apart from the contact's own keys (a save refreshes the contact, not these) and stay fresh for a few minutes.
 */
export const fieldsKey = ['fields', 'contacts'] as const;
export const fieldOptionsKey = (fieldId: string) => ['fields', 'options', fieldId] as const;
export const statusOptionsKey = ['status-options', 'contacts'] as const;
export const assigneesKey = ['contact-assignees'] as const;

const FIVE_MINUTES = 5 * 60_000;
/** A finished mutation is not looked at again, so the cache forgets it at once. */
const NO_KEEP = 0;

/** The person may not read this (the API answered 403): the screen falls back to what it already has instead of failing. */
export const isDenied = (error: unknown): boolean => isApiError(error) && error.status === 403;

/** The workspace's contact properties. No request when `enabled` is false (the person may not read them). */
export const useContactFields = (enabled: boolean) =>
  useQuery({
    queryKey: fieldsKey,
    queryFn: ({ signal }) => listContactFields(signal),
    enabled,
    staleTime: FIVE_MINUTES,
  });

export const dependenciesKey = ['fields', 'dependencies', 'contacts'] as const;

/** Which properties depend on which. No request when `enabled` is false (the person may not read properties). */
export const useContactFieldDependencies = (enabled: boolean) =>
  useQuery({
    queryKey: dependenciesKey,
    queryFn: ({ signal }) => listContactFieldDependencies(signal),
    enabled,
    staleTime: FIVE_MINUTES,
  });

export const useFieldOptions = (fieldId: string, enabled: boolean) =>
  useQuery({
    queryKey: fieldOptionsKey(fieldId),
    queryFn: ({ signal }) => listFieldOptions(fieldId, signal),
    enabled: enabled && fieldId !== '',
    staleTime: FIVE_MINUTES,
  });

/** Lifecycle stages, statuses and lost reasons. */
export const useStatusOptions = (enabled: boolean) =>
  useQuery({
    queryKey: statusOptionsKey,
    queryFn: ({ signal }) => listContactStatusOptions(signal),
    enabled,
    staleTime: FIVE_MINUTES,
  });

/** The people a contact can be given to; also how an owner's id becomes a name. */
export const useAssignees = (enabled: boolean) =>
  useQuery({
    queryKey: assigneesKey,
    queryFn: ({ signal }) => listAssignees(signal),
    enabled,
    staleTime: FIVE_MINUTES,
  });

/** One idempotency key per owner change: a repeat after a lost connection is the same request, any answer ends the action. */
function useActionKey() {
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

/**
 * Gives the contact to someone (or no one). This is the bulk owner call, not the contact update, on purpose: it carries no
 * `rowVersion`, so it cannot lose to someone editing a phone number at the same moment, and it changes only the owner. The
 * save bumps the contact's version, so the contact is read again; the mutation stays pending until it has been, and the sheet
 * closes on the fresh copy. A contact the API could not change is in `failed` of the answer, which the caller reads.
 */
export function useSetOwner(contactId: string) {
  const queryClient = useQueryClient();
  const key = useActionKey();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (ownerId: string | null) =>
      setContactAssignee({ ids: [contactId], ownerId }, key.current()),
    onError: key.failed,
    onSuccess: async (result) => {
      key.renew();
      if (result.failed.length > 0) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: contactKey(contactId) }),
        queryClient.invalidateQueries({ queryKey: [...contactsKey, 'list'] }),
      ]);
    },
  });
}

export interface EditFailure {
  /** A message about the whole sheet. */
  banner: string | null;
  /** A message under the field being edited. */
  field: string | null;
  /** Someone else saved the contact first: the sheet reads it again and asks the person to look once more. */
  conflict: boolean;
}

/**
 * What an edit sheet shows when the SERVER refuses a save, chosen by the error `code` (the server's English text is never
 * shown). Anything the app has no sentence for becomes the generic failure.
 */
export function describeEditFailure(error: unknown, t: TFunction): EditFailure {
  const banner = (message: string): EditFailure => ({
    banner: message,
    field: null,
    conflict: false,
  });
  if (isApiError(error)) {
    if (error.isRowVersionConflict) return { banner: null, field: null, conflict: true };
    switch (error.code) {
      case ERROR_CODES.CON_PROPERTY_NOT_EDITABLE:
        return banner(t('contactProps.error.notEditable'));
      case ERROR_CODES.CON_REQUIRED_PROPERTY_MISSING:
        return banner(t('contactProps.error.requiredMissing'));
      case ERROR_CODES.CON_LOST_REASON_REQUIRED:
        return banner(t('contactProps.error.lostReasonRequired'));
      case ERROR_CODES.CON_STATUS_STAGE_MISMATCH:
        return banner(t('contactProps.error.statusMismatch'));
      case ERROR_CODES.VALIDATION_FAILED:
        if (error.fieldErrors.length > 0) {
          return { banner: null, field: t('contactProps.error.invalid'), conflict: false };
        }
    }
  }
  return banner(messageForError(error, t));
}
