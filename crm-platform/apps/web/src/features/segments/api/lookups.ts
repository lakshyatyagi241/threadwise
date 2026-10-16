'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  isUsableProperty,
  stageChoices,
  statusChoices,
  useContactFields,
  useGroups,
  useModuleFields,
  useStatusOptions,
  useTags,
} from '@/features/contacts-attributes-tags';
import { buildCatalog, type Choice, type FieldDef, type Lookups } from '../lib/fields';
import { fetchAll } from './http';
import { personSchema, teamOptionSchema } from './schemas';

/** The workspace's people, for the owner picker and the Owner column. */
export function usePeople(enabled = true) {
  return useQuery({
    queryKey: ['segments', 'people'],
    queryFn: ({ signal }) => fetchAll('/users', personSchema, {}, { signal }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** The workspace's teams, for the "Specific people" picker. A person who cannot list teams gets people only. */
export function useTeams(enabled = true) {
  return useQuery({
    queryKey: ['segments', 'teams'],
    queryFn: ({ signal }) => fetchAll('/workspace/teams', teamOptionSchema, {}, { signal }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface SegmentCatalog {
  /** Every field a condition can test, grouped by the picker. */
  catalog: FieldDef[];
  lookups: Lookups;
  /** The lookups behind the catalog have all answered (until then nothing is judged deleted). */
  ready: boolean;
  /** One of the lookups failed: the builder still works with what loaded and says so. */
  failed: boolean;
  /** A person's name by id, for the Owner column. */
  personName: (id: string | null | undefined) => string | undefined;
}

const toChoice = (c: { value: string; label: string; color?: string }): Choice => c;

/**
 * Stages, statuses, tags, groups, people and custom properties as one catalog of fields. The queries are the contacts
 * screens' own (same cache), so opening the builder after the Contact Hub costs nothing.
 */
export function useSegmentCatalog(): SegmentCatalog {
  const tf = useTranslations('contacts-attributes-tags.form');
  const statusOptions = useStatusOptions();
  const tags = useTags();
  const groups = useGroups();
  const fields = useContactFields();
  const people = usePeople();
  // Company properties are offered to someone who may read their definitions; a refusal just leaves the group out (it is not a failure
  // of the builder, so it is not counted in `ready` or `failed`).
  const companyFields = useModuleFields('companies', false);

  const all = [statusOptions, tags, groups, fields, people];
  // A rule on a company property is judged deleted only once the company properties have answered (or been refused).
  const ready = [...all, companyFields].every((q) => q.isSuccess || q.isError);
  const failed = all.some((q) => q.isError);

  const lookups = useMemo<Lookups>(
    () => ({
      stages: stageChoices(statusOptions.data).map(toChoice),
      statuses: statusChoices(statusOptions.data, (v) => tf(`statuses.${v}`)).map(toChoice),
      tags: (tags.data ?? []).map((t) => ({
        value: t.id,
        label: t.name,
        ...(t.color ? { color: t.color } : {}),
      })),
      groups: (groups.data ?? []).map((g) => ({
        value: g.id,
        label: g.name,
        ...(g.color ? { color: g.color } : {}),
      })),
      users: (people.data ?? []).map((u) => ({ value: u.id, label: u.fullName })),
      properties: (fields.data ?? []).filter(isUsableProperty).map((f) => ({
        key: f.key,
        label: f.label,
        fieldType: f.fieldType,
        options: (f.options ?? [])
          .filter((o) => !o.isHidden)
          .sort((a, b) => a.position - b.position)
          .map((o) => ({ value: o.value, label: o.label })),
      })),
      companyProperties: (companyFields.data ?? []).filter(isUsableProperty).map((f) => ({
        key: f.key,
        label: f.label,
        fieldType: f.fieldType,
        options: (f.options ?? [])
          .filter((o) => !o.isHidden)
          .sort((a, b) => a.position - b.position)
          .map((o) => ({ value: o.value, label: o.label })),
      })),
    }),
    [statusOptions.data, tags.data, groups.data, fields.data, people.data, companyFields.data, tf],
  );
  const catalog = useMemo(() => buildCatalog(lookups), [lookups]);
  const names = useMemo(
    () => new Map((people.data ?? []).map((u) => [u.id, u.fullName])),
    [people.data],
  );
  return {
    catalog,
    lookups,
    ready,
    failed,
    personName: (id) => (id ? names.get(id) : undefined),
  };
}
