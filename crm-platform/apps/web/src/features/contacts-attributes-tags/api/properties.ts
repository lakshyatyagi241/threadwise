'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  fieldDependencyResponseSchema,
  fieldOptionResponseSchema,
  fieldSectionResponseSchema,
  fieldUsageResponseSchema,
  type CreateFieldInput,
  type FieldOptionResponse,
  type FieldResponse,
  type FieldSectionResponse,
  type UpdateFieldInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { KEYS } from './contacts';
import { fetchAllPages } from './http';
import { fieldResponseSchema } from './schemas';

/**
 * Contact properties are the rows of the field registry (`/v2/fields`, module `contacts`), grouped by
 * `/v2/field-sections`. Attributes (`/v2/attributes`) read and write the same rows, so every change here also
 * reaches the Attributes screen, the slash picker and the merge-tag resolver; `invalidateProperties` refreshes all.
 */

const FIELDS = ['cat', 'fields'] as const;
const SECTIONS = ['cat', 'field-sections'] as const;
const USAGE = ['cat', 'field-usage'] as const;
const DEPENDENCIES = ['cat', 'field-dependencies'] as const;

/** Custom properties of the contacts module. Inactive ones come only when asked for (the screen's "show inactive"). */
export function useContactFields(includeInactive = false) {
  return useQuery({
    queryKey: [...FIELDS, includeInactive],
    queryFn: ({ signal }) =>
      fetchAllPages(
        '/fields',
        fieldResponseSchema,
        { moduleKey: 'contacts', ...(includeInactive ? { includeInactive: true } : {}) },
        { signal },
      ),
    staleTime: 60_000,
  });
}

export function useFieldSections() {
  return useQuery({
    queryKey: SECTIONS,
    queryFn: ({ signal }) =>
      fetchAllPages('/field-sections', fieldSectionResponseSchema, { moduleKey: 'contacts' }, { signal }),
    staleTime: 60_000,
  });
}

/** Contacts holding a value for each property, by property id. */
export function useFieldUsage(enabled = true) {
  return useQuery({
    queryKey: USAGE,
    enabled,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/fields/usage', {
        query: { moduleKey: 'contacts' },
        schema: fieldUsageResponseSchema,
        signal,
      });
      return new Map(res.data.map((r) => [r.id, r.count]));
    },
  });
}

export function useFieldDependencies() {
  return useQuery({
    queryKey: DEPENDENCIES,
    queryFn: ({ signal }) =>
      apiFetch('/fields/dependencies', {
        query: { moduleKey: 'contacts' },
        schema: z.array(fieldDependencyResponseSchema),
        signal,
      }),
    staleTime: 60_000,
  });
}

/** Everything that shows properties: this screen, the contact form and profile, the Attributes screen and the picker. */
export function invalidateProperties(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: FIELDS }),
    qc.invalidateQueries({ queryKey: SECTIONS }),
    qc.invalidateQueries({ queryKey: USAGE }),
    qc.invalidateQueries({ queryKey: DEPENDENCIES }),
    qc.invalidateQueries({ queryKey: KEYS.attributes }),
    qc.invalidateQueries({ queryKey: KEYS.attributePicker }),
  ]);
}

// --- properties -----------------------------------------------------------------------------------------------

export const createField = (body: CreateFieldInput): Promise<FieldResponse> =>
  apiFetch('/fields', { method: 'POST', body, schema: fieldResponseSchema });

export const updateField = (id: string, body: UpdateFieldInput): Promise<FieldResponse> =>
  apiFetch(`/fields/${id}`, { method: 'PATCH', body, schema: fieldResponseSchema });

/** The API deactivates (the values contacts hold stay); a system property is refused with 409 FIELD_IS_SYSTEM. */
export const deactivateField = (id: string): Promise<void> =>
  apiFetch(`/fields/${id}`, { method: 'DELETE' });

export const reorderFields = (sectionId: string, orderedIds: string[]): Promise<void> =>
  apiFetch('/fields/reorder', {
    method: 'POST',
    body: { moduleKey: 'contacts', sectionId, orderedIds },
  });

// --- options ----------------------------------------------------------------------------------------------------

export const createFieldOption = (
  fieldId: string,
  o: { value: string; label: string; position?: number },
): Promise<FieldOptionResponse> =>
  apiFetch(`/fields/${fieldId}/options`, {
    method: 'POST',
    body: o,
    schema: fieldOptionResponseSchema,
  });

export const renameFieldOption = (
  option: Pick<FieldOptionResponse, 'id' | 'rowVersion'>,
  label: string,
): Promise<FieldOptionResponse> =>
  apiFetch(`/fields/options/${option.id}`, {
    method: 'PATCH',
    body: { label, rowVersion: option.rowVersion },
    schema: fieldOptionResponseSchema,
  });

export const deleteFieldOption = (id: string): Promise<void> =>
  apiFetch(`/fields/options/${id}`, { method: 'DELETE' });

export const reorderFieldOptions = (fieldId: string, orderedIds: string[]): Promise<void> =>
  apiFetch(`/fields/${fieldId}/options/reorder`, { method: 'POST', body: { orderedIds } });

// --- dependencies ---------------------------------------------------------------------------------------------

export const createFieldDependency = (body: {
  fieldId: string;
  dependsOnFieldId: string;
  dependsOnOptionId?: string;
  dependsOnValue?: string;
}) =>
  apiFetch('/fields/dependencies', {
    method: 'POST',
    body,
    schema: fieldDependencyResponseSchema,
  });

export const deleteFieldDependency = (id: string): Promise<void> =>
  apiFetch(`/fields/dependencies/${id}`, { method: 'DELETE' });

// --- sections ---------------------------------------------------------------------------------------------------

export const createSection = (name: string): Promise<FieldSectionResponse> =>
  apiFetch('/field-sections', {
    method: 'POST',
    body: { moduleKey: 'contacts', name: name.trim() },
    schema: fieldSectionResponseSchema,
  });

export const renameSection = (
  section: Pick<FieldSectionResponse, 'id' | 'rowVersion'>,
  name: string,
): Promise<FieldSectionResponse> =>
  apiFetch(`/field-sections/${section.id}`, {
    method: 'PATCH',
    body: { name: name.trim(), rowVersion: section.rowVersion },
    schema: fieldSectionResponseSchema,
  });

export const reorderSections = (orderedIds: string[]): Promise<void> =>
  apiFetch('/field-sections/reorder', {
    method: 'POST',
    body: { moduleKey: 'contacts', orderedIds },
  });

/** The properties of a deleted section are not deleted: they become sectionless. */
export const deleteSection = (id: string): Promise<void> =>
  apiFetch(`/field-sections/${id}`, { method: 'DELETE' });
