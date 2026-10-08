'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  WABA_GROUP_DESCRIPTION_MAX,
  WABA_GROUP_SUBJECT_MAX,
  type WabaGroupJoinMode,
} from '@crm/contracts';
import { Button, Card, Field, Input, Select, Textarea } from '@crm/ui';
import { useCreateGroup } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import type { GroupNotice } from './groups-model';

/** Reference draws the create form inline above the list: name (max 128), who can join, description (max 2048). */
export function CreateGroupForm({
  number,
  onNotice,
}: {
  number: string;
  onNotice: (n: GroupNotice) => void;
}) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups');
  const errorText = useErrorText();
  const create = useCreateGroup(number);
  const [subject, setSubject] = useState('');
  const [mode, setMode] = useState<WabaGroupJoinMode>('auto_approve');
  const [description, setDescription] = useState('');

  const valid = subject.trim().length > 0 && subject.trim().length <= WABA_GROUP_SUBJECT_MAX;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || create.isPending) return;
    create.mutate(
      {
        subject: subject.trim(),
        joinApprovalMode: mode,
        ...(description.trim() ? { description: description.trim() } : {}),
      },
      {
        onSuccess: () => {
          setSubject('');
          setDescription('');
          setMode('auto_approve');
          onNotice({ tone: 'success', text: t('notice.created') });
        },
        onError: (err) => {
          const et = errorText(err);
          onNotice({ tone: 'danger', text: et.text, requestId: et.requestId });
        },
      },
    );
  };

  return (
    <Card className="p-5">
      <p className="text-lg font-semibold">{t('create.title')}</p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t('create.name')} htmlFor="wg-subject" hint={t('create.nameHint')}>
          <Input
            id="wg-subject"
            name="subject"
            value={subject}
            maxLength={WABA_GROUP_SUBJECT_MAX}
            required
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field label={t('create.who')} htmlFor="wg-mode" hint={t('create.whoHint')}>
          <Select
            id="wg-mode"
            name="join_approval_mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as WabaGroupJoinMode)}
          >
            <option value="auto_approve">{t('create.whoAuto')}</option>
            <option value="approval_required">{t('create.whoApproval')}</option>
          </Select>
        </Field>
        <Field
          label={t('create.description')}
          htmlFor="wg-description"
          hint={t('create.descriptionHint')}
          className="sm:col-span-2"
        >
          <Textarea
            id="wg-description"
            name="description"
            rows={2}
            value={description}
            maxLength={WABA_GROUP_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!valid || create.isPending}>
            {create.isPending ? t('create.submitting') : t('create.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
