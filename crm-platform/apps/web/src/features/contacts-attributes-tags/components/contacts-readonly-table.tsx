'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useLeadScoringEnabled } from '@/features/lead-scoring';
import { useStoredValue } from '@/lib/use-stored-value';
import { useAttributes, useStatusOptions } from '../api/attributes';
import { useOwnerNames } from '../api/owners';
import type { ContactRow } from '../api/schemas';
import {
  addableColumns,
  allColumns,
  hideColumn,
  omittedColumns,
  parseStoredColumns,
  serializeColumns,
  showColumn,
  STORAGE_KEY as COLUMNS_KEY,
  visibleColumns,
} from '../lib/columns';
import { stageChoices, statusChoices } from '../lib/option-sets';
import { rowView } from '../lib/row-view';
import { ContactsTable } from './contacts-list';

const NONE: ReadonlySet<string> = new Set();
const noop = () => undefined;

/** The columns a person chose for a segment's members; until they choose, the Contact Hub's columns are used. */
export const MEMBER_COLUMNS_KEY = 'segments.memberColumns';

/**
 * Contacts in the same table as the Contact Hub (same columns, the ones the person picked in "Modify columns", frozen
 * name column, thin scrollbar) but read-only: no checkboxes, no stage menu, only "View" in the row menu. Other screens
 * that list contacts (the members of a segment) use this so the list never drifts from the hub. The header menu and the "+" column
 * picker choose which columns a segment's members show (kept in this browser, apart from the hub's own choice).
 */
export function ContactsReadonlyTable({ rows }: { rows: readonly ContactRow[] }) {
  const tf = useTranslations('contacts-attributes-tags.form');
  const router = useRouter();
  const attributes = useAttributes();
  const statusOptions = useStatusOptions();
  const { nameOf: ownerName } = useOwnerNames();
  const [hubColumns] = useStoredValue(COLUMNS_KEY);
  const [ownColumns, setOwnColumns] = useStoredValue(MEMBER_COLUMNS_KEY);
  const storedColumns = ownColumns ?? hubColumns;
  const attributeColumns = useMemo(
    () =>
      (attributes.data ?? [])
        .filter((a) => a.active && !a.hidden)
        .map((a) => ({ key: a.key, name: a.name })),
    [attributes.data],
  );
  const scoringOn = useLeadScoringEnabled();
  const omit = useMemo(() => omittedColumns({ canCompany: true, scoringOn }), [scoringOn]);
  const columns = useMemo(
    () => visibleColumns(parseStoredColumns(storedColumns), attributeColumns, null, omit),
    [storedColumns, attributeColumns, omit],
  );
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const addable = useMemo(
    () => addableColumns(allColumns(attributeColumns, omit), columnIds),
    [attributeColumns, omit, columnIds],
  );
  const attrLabels = useMemo(
    () => new Map((attributes.data ?? []).map((a) => [a.key, a.name])),
    [attributes.data],
  );
  const stages = useMemo(() => stageChoices(statusOptions.data), [statusOptions.data]);
  const statuses = useMemo(
    () => statusChoices(statusOptions.data, (v) => tf(`statuses.${v}`)),
    [statusOptions.data, tf],
  );
  const views = useMemo(() => rows.map((r) => rowView(r, attrLabels)), [rows, attrLabels]);

  return (
    <ContactsTable
      rows={views}
      columns={columns}
      headerState="none"
      onToggleAll={noop}
      selectable={false}
      columnTools={{
        addable,
        onAdd: (id) => setOwnColumns(serializeColumns(showColumn(columnIds, id))),
        onHide: (id) => setOwnColumns(serializeColumns(hideColumn(columnIds, id))),
        hasFilter: () => false,
        onFilter: noop,
      }}
      selected={NONE}
      canEdit={false}
      canDelete={false}
      stageLabel={(v) => stages.find((x) => x.value === v)?.label ?? v}
      stageChoices={stages}
      statusLabel={(v) => statuses.find((x) => x.value === v)?.label ?? v}
      ownerLabel={(id) => ownerName(id) ?? ''}
      onToggle={noop}
      onView={(id) => router.push(`/contacts/${id}`)}
      onEdit={noop}
      onDelete={noop}
      onAddToGroup={noop}
      onTag={noop}
    />
  );
}
