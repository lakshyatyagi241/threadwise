'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import {
  WA_DEVICE_GROUP_DESCRIPTION_MAX,
  WA_DEVICE_GROUP_PICTURE_MAX_BYTES,
  WA_DEVICE_GROUP_PICTURE_MIME_TYPES,
  WA_DEVICE_GROUP_SUBJECT_MAX,
  type WaDeviceGroup,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Switch, Textarea } from '@crm/ui';
import {
  useRemoveWaGroupPicture,
  useSetWaGroupPicture,
  useUpdateWaGroup,
} from '../api/groups-hooks';
import { useGroupsCtx } from './groups-context';
import { checkPicture, draftOf, editPatch, type EditDraft } from './groups-model';
import { GroupPicture } from './group-picture';

/**
 * Subject, description, the four settings and the picture of a group the number administers. The text and settings go in one PATCH
 * (only the fields that changed); the picture is its own upload. Every change reaches WhatsApp before the answer, so what the page
 * shows afterwards is what WhatsApp holds.
 */
export function EditGroupModal({
  group,
  open,
  onClose,
}: {
  group: WaDeviceGroup;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('whatsapp-devices-baileys.groups.edit');
  const tc = useTranslations('whatsapp-devices-baileys.groups');
  const { device, online, waitSeconds, notify, fail } = useGroupsCtx();
  const update = useUpdateWaGroup(device.id);
  const setPicture = useSetWaGroupPicture(device.id);
  const removePicture = useRemoveWaGroupPicture(device.id);
  const [dropPicture, setDropPicture] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => draftOf(group));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<'type' | 'size' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const patch = editPatch(group, draft);
  const blocked = !online || waitSeconds > 0;

  // The local preview of the chosen picture is made when it is picked and given back when it changes or the window closes.
  const previewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );
  const showPreview = (f: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = f ? URL.createObjectURL(f) : null;
    setPreview(previewRef.current);
  };

  const set = <K extends keyof EditDraft>(k: K, v: EditDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const pick = (f: File | null) => {
    setFileError(null);
    if (!f) {
      showPreview(null);
      return setFile(null);
    }
    const check = checkPicture(
      f,
      WA_DEVICE_GROUP_PICTURE_MAX_BYTES,
      WA_DEVICE_GROUP_PICTURE_MIME_TYPES,
    );
    if (check !== 'ok') {
      showPreview(null);
      setFile(null);
      setFileError(check);
      if (input.current) input.current.value = '';
      return;
    }
    setDropPicture(false);
    showPreview(f);
    setFile(f);
  };

  const save = async () => {
    if (blocked || update.isPending || setPicture.isPending) return;
    try {
      if (patch) await update.mutateAsync({ group: group.id, input: patch });
      if (file) await setPicture.mutateAsync({ group: group.id, file });
      else if (dropPicture) await removePicture.mutateAsync(group.id);
    } catch (err) {
      fail(err);
      return;
    }
    notify({ tone: 'success', text: t('saved') });
    onClose();
  };

  const busy = update.isPending || setPicture.isPending || removePicture.isPending;
  const canSave =
    (patch !== null || file !== null || dropPicture) && draft.subject.trim().length > 0 && !blocked;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button disabled={!canSave || busy} onClick={() => void save()}>
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <GroupPicture url={preview ?? (dropPicture ? null : group.pictureUrl)} size={56} />
          <div className="min-w-0">
            <input
              ref={input}
              id={`${id}-picture`}
              type="file"
              accept={WA_DEVICE_GROUP_PICTURE_MIME_TYPES.join(',')}
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => input.current?.click()}
              disabled={blocked}
            >
              {t('choosePicture')}
            </Button>
            {group.pictureUrl && !file && (
              <Button
                variant="secondary"
                size="sm"
                className="ms-2"
                disabled={blocked}
                onClick={() => setDropPicture((v) => !v)}
              >
                {dropPicture ? t('keepPicture') : t('removePicture')}
              </Button>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {file
                ? file.name
                : t('pictureHint', { mb: WA_DEVICE_GROUP_PICTURE_MAX_BYTES / 1048576 })}
            </p>
            {fileError && (
              <p className="text-xs text-danger" data-testid="groups-picture-error">
                {t(fileError === 'type' ? 'pictureType' : 'pictureSize', {
                  mb: WA_DEVICE_GROUP_PICTURE_MAX_BYTES / 1048576,
                })}
              </p>
            )}
          </div>
        </div>

        <Field label={t('subject')} htmlFor={`${id}-subject`}>
          <Input
            id={`${id}-subject`}
            value={draft.subject}
            maxLength={WA_DEVICE_GROUP_SUBJECT_MAX}
            onChange={(e) => set('subject', e.target.value)}
          />
        </Field>
        <Field label={t('description')} htmlFor={`${id}-description`}>
          <Textarea
            id={`${id}-description`}
            rows={3}
            value={draft.description}
            maxLength={WA_DEVICE_GROUP_DESCRIPTION_MAX}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('settings')}</legend>
          <SettingRow
            id={`${id}-announce`}
            label={t('announce')}
            hint={t('announceHint')}
            checked={draft.announce}
            onChange={(v) => set('announce', v)}
          />
          <SettingRow
            id={`${id}-restrict`}
            label={t('restrict')}
            hint={t('restrictHint')}
            checked={draft.restrict}
            onChange={(v) => set('restrict', v)}
          />
          <SettingRow
            id={`${id}-approval`}
            label={t('approval')}
            hint={t('approvalHint')}
            checked={draft.joinApproval}
            onChange={(v) => set('joinApproval', v)}
          />
          <SettingRow
            id={`${id}-addmode`}
            label={t('addMode')}
            hint={t('addModeHint')}
            checked={draft.memberAddMode === 'admin_add'}
            onChange={(v) => set('memberAddMode', v ? 'admin_add' : 'all_member_add')}
          />
        </fieldset>

        {!online && <Alert tone="warning">{t('offline')}</Alert>}
      </div>
    </Modal>
  );
}

function SettingRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="min-w-0 text-sm">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} label={label} />
    </div>
  );
}
