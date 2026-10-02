'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, ConfirmDialog, Field, Input, Modal, Select, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useGroups, useTags } from '@/features/contacts-attributes-tags';
import {
  addMembersToGroup,
  createSegment,
  deleteSegment,
  exportMembers,
  invalidateSegments,
  refreshCount,
  tagMembers,
} from '../api/segments';
import { SEGMENT_NAME_MAX, type Segment, type SegmentActionResponse } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { copyName } from '../lib/hub';
import { ROUTES } from '../lib/url';
import { ErrorLine } from './parts';

export type ActionDialog = { kind: 'delete' | 'tag' | 'group'; segment: Segment } | null;

/** What the signed-in person may do with a segment, from their permissions and the segment's own `canEdit`. */
export function useSegmentCan() {
  const create = useCan('record.segments.create');
  const update = useCan('record.segments.update');
  const del = useCan('record.segments.delete');
  const exportContacts = useCan('record.contacts.export');
  const updateContacts = useCan('record.contacts.update');
  const createTags = useCan('record.tags.create');
  return {
    create,
    createTags,
    edit: (s: Segment) => update && s.canEdit,
    remove: (s: Segment) => del && s.canEdit,
    export: exportContacts,
    members: updateContacts,
  };
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The actions a segment's menu offers (hub rows and the detail page share them): recount, export, duplicate, and the
 * three that ask first (delete, tag members, add to group). Render `<SegmentDialogs controller={...} />` once.
 */
export function useSegmentActions({
  taken,
  onDeleted,
}: {
  /** Names in use, so a duplicate gets a free one. */
  taken: () => string[];
  onDeleted?: (segment: Segment) => void;
}) {
  const t = useTranslations('segments.actions');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState<ReadonlySet<string>>(new Set());

  const mark = (set: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  const failed = (e: unknown) => {
    const kind = errorKind(e);
    toast(t(kind === 'forbidden' ? 'forbidden' : kind === 'rateLimited' ? 'rateLimited' : kind === 'unavailable' ? 'unavailable' : 'failed'), 'danger');
  };

  return {
    dialog,
    open: (kind: 'delete' | 'tag' | 'group', segment: Segment) => setDialog({ kind, segment }),
    close: () => setDialog(null),
    refreshing,
    exporting,

    async refresh(segment: Segment) {
      setRefreshing((s) => mark(s, segment.id, true));
      try {
        await refreshCount(segment.id);
        await invalidateSegments(qc);
      } catch (e) {
        failed(e);
      } finally {
        setRefreshing((s) => mark(s, segment.id, false));
      }
    },

    async exportCsv(segment: Segment) {
      setExporting((s) => mark(s, segment.id, true));
      try {
        const { blob, filename } = await exportMembers(segment.id);
        download(filename, blob);
        toast(t('exportStarted'), 'success');
      } catch (e) {
        const kind = errorKind(e);
        toast(t(kind === 'conflict' || kind === 'validation' ? 'exportTooLarge' : kind === 'forbidden' ? 'forbidden' : 'failed'), 'danger');
      } finally {
        setExporting((s) => mark(s, segment.id, false));
      }
    },

    async duplicate(segment: Segment) {
      try {
        const copy = await createSegment({
          name: copyName(segment.name, taken(), SEGMENT_NAME_MAX),
          description: segment.description,
          color: segment.color,
          visibility: segment.visibility,
          rules: segment.rules,
        });
        await invalidateSegments(qc);
        toast(t('duplicated', { name: copy.name }), 'success');
        router.push(ROUTES.edit(copy.id));
      } catch (e) {
        failed(e);
      }
    },

    async confirmDelete(segment: Segment) {
      try {
        await deleteSegment(segment.id);
      } catch (e) {
        // Gone already (deleted in another tab): the list is stale, which is not an error.
        if (errorKind(e) !== 'notFound') {
          setDialog(null);
          failed(e);
          return;
        }
      }
      setDialog(null);
      await invalidateSegments(qc);
      toast(t('deleted', { name: segment.name }), 'success');
      onDeleted?.(segment);
    },
  };
}

export type SegmentActions = ReturnType<typeof useSegmentActions>;

function reportBulk(
  toast: ReturnType<typeof useToast>['toast'],
  t: ReturnType<typeof useTranslations>,
  r: SegmentActionResponse,
  key: 'tagged' | 'addedToGroup',
  name: string,
) {
  if (r.queued) toast(t('queued', { count: r.matched }), 'info');
  else toast(t(key, { count: r.changed, name }), r.changed === 0 ? 'info' : 'success');
}

/** The delete confirmation and the two member actions (tag, add to group), one at a time. */
export function SegmentDialogs({ controller }: { controller: SegmentActions }) {
  const t = useTranslations('segments.actions');
  const { dialog, close } = controller;
  const segment = dialog?.segment;
  return (
    <>
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        tone="danger"
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: segment?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('keep')}
        onClose={close}
        onConfirm={() => segment && void controller.confirmDelete(segment)}
      />
      {dialog?.kind === 'tag' && <TagModal segment={dialog.segment} onClose={close} />}
      {dialog?.kind === 'group' && <GroupModal segment={dialog.segment} onClose={close} />}
    </>
  );
}

/** "Applies to the 120 people in this segment right now" (or without the number when it was never counted). */
function SnapshotNote({ segment }: { segment: Segment }) {
  const t = useTranslations('segments.actions');
  return (
    <Alert tone="info" className="text-xs">
      {segment.memberCount === null
        ? t('snapshotNoteUnknown')
        : t(segment.countApproximate ? 'snapshotNoteApprox' : 'snapshotNote', { count: segment.memberCount })}
    </Alert>
  );
}

function TagModal({ segment, onClose }: { segment: Segment; onClose: () => void }) {
  const t = useTranslations('segments.actions');
  const can = useSegmentCan();
  const qc = useQueryClient();
  const { toast } = useToast();
  const tags = useTags();
  const [tagId, setTagId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const list = tags.data ?? [];
  const chosen = name.trim() ? undefined : tagId || list[0]?.id;
  const ready = Boolean(name.trim() || chosen);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const r = await tagMembers(segment.id, name.trim() ? { name: name.trim() } : { tagId: chosen });
      await Promise.all([invalidateSegments(qc), qc.invalidateQueries({ queryKey: ['cat'] })]);
      const label = name.trim() || list.find((x) => x.id === chosen)?.name || '';
      reportBulk(toast, t, r, 'tagged', label);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={t('tagTitle')} eyebrow={segment.name} closeLabel={t('close')} footer={
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button onClick={() => void apply()} disabled={busy || !ready}>
          {busy && <Spinner />}
          {t('tagApply')}
        </Button>
      </>
    }>
      <div className="space-y-3">
        <SnapshotNote segment={segment} />
        {error ? <ErrorLine error={error} /> : null}
        <Field label={t('tagExisting')} htmlFor="seg-tag-existing">
          <Select id="seg-tag-existing" value={chosen ?? ''} disabled={Boolean(name.trim()) || list.length === 0} onChange={(e) => setTagId(e.target.value)}>
            {list.length === 0 && <option value="">{t('noTags')}</option>}
            {list.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Select>
        </Field>
        {can.createTags && (
          <Field label={t('tagNew')} htmlFor="seg-tag-new" hint={t('tagNewHint')}>
            <Input id="seg-tag-new" value={name} maxLength={64} placeholder={t('tagNewPlaceholder')} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function GroupModal({ segment, onClose }: { segment: Segment; onClose: () => void }) {
  const t = useTranslations('segments.actions');
  const qc = useQueryClient();
  const { toast } = useToast();
  const groups = useGroups();
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const list = groups.data ?? [];
  const chosen = groupId || list[0]?.id || '';

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const r = await addMembersToGroup(segment.id, chosen);
      await Promise.all([invalidateSegments(qc), qc.invalidateQueries({ queryKey: ['cat'] })]);
      reportBulk(toast, t, r, 'addedToGroup', list.find((g) => g.id === chosen)?.name ?? '');
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={t('groupTitle')} eyebrow={segment.name} closeLabel={t('close')} footer={
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button onClick={() => void apply()} disabled={busy || !chosen}>
          {busy && <Spinner />}
          {t('groupApply')}
        </Button>
      </>
    }>
      <div className="space-y-3">
        <SnapshotNote segment={segment} />
        {error ? <ErrorLine error={error} /> : null}
        <Field label={t('groupChoose')} htmlFor="seg-group">
          <Select id="seg-group" value={chosen} disabled={list.length === 0} onChange={(e) => setGroupId(e.target.value)}>
            {list.length === 0 && <option value="">{t('noGroups')}</option>}
            {list.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
