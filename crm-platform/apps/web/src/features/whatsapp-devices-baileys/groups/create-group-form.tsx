'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  PERSONAL_WA_NOTICE_VERSION,
  WA_DEVICE_GROUP_DESCRIPTION_MAX,
  WA_DEVICE_GROUP_SUBJECT_MAX,
  type CreateWaDeviceGroupResult,
} from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Field, Input, Textarea } from '@crm/ui';
import { useCreateWaGroup } from '../api/groups-hooks';
import { RiskNotice } from '../components/risk-notice';
import { useGroupsCtx } from './groups-context';
import { NUMBERS_PER_CALL, numbersOk, parseNumbers, summarizeResults } from './groups-model';
import { OutcomeList } from './outcome-list';

/**
 * Creates a group on the number on show: a name, an optional description and the first members by phone number (at most 20 per call).
 * Creating groups and adding people are the actions WhatsApp watches most, so the form says so, offers the full notice, and needs the
 * box ticked before it sends (`acknowledgeRisk`). The answer says what happened to each number: privacy settings may refuse some.
 */
export function CreateGroupForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('whatsapp-devices-baileys.groups.create');
  const tc = useTranslations('whatsapp-devices-baileys.groups');
  const { device, online, waitSeconds, notify, fail } = useGroupsCtx();
  const create = useCreateWaGroup(device.id);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [numbersText, setNumbersText] = useState('');
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<CreateWaDeviceGroupResult | null>(null);
  const id = useId();

  const parsed = parseNumbers(numbersText, device.phone);
  const valid =
    subject.trim().length > 0 &&
    subject.trim().length <= WA_DEVICE_GROUP_SUBJECT_MAX &&
    numbersOk(parsed) &&
    ack;
  const blocked = !online || waitSeconds > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || blocked || create.isPending) return;
    create.mutate(
      {
        subject: subject.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        numbers: parsed.valid,
        acknowledgeRisk: true,
      },
      {
        onSuccess: (r) => {
          setResult(r);
          setSubject('');
          setDescription('');
          setNumbersText('');
          setAck(false);
          notify({
            tone: r.participants.failCount > 0 || !r.descriptionSet ? 'warning' : 'success',
            text: t('created', { name: r.group.subject ?? '' }),
          });
        },
        onError: fail,
      },
    );
  };

  const sum = result ? summarizeResults(result.participants.results) : null;

  return (
    <Card className="p-5" data-testid="groups-create">
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-semibold">{t('title')}</p>
        <Button variant="secondary" size="sm" onClick={onDone}>
          {tc('close')}
        </Button>
      </div>

      <Alert tone="warning" className="mt-3" data-testid="groups-create-risk">
        {t('risk')}
      </Alert>

      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t('subject')} htmlFor={`${id}-subject`} hint={t('subjectHint')}>
          <Input
            id={`${id}-subject`}
            name="subject"
            value={subject}
            maxLength={WA_DEVICE_GROUP_SUBJECT_MAX}
            required
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field
          label={t('numbers')}
          htmlFor={`${id}-numbers`}
          hint={t('numbersHint', { max: NUMBERS_PER_CALL })}
          className="sm:row-span-2"
        >
          <Textarea
            id={`${id}-numbers`}
            name="numbers"
            rows={5}
            dir="ltr"
            value={numbersText}
            placeholder={t('numbersPlaceholder')}
            onChange={(e) => setNumbersText(e.target.value)}
          />
        </Field>
        <Field
          label={t('description')}
          htmlFor={`${id}-description`}
          hint={t('descriptionHint', { max: WA_DEVICE_GROUP_DESCRIPTION_MAX })}
        >
          <Textarea
            id={`${id}-description`}
            name="description"
            rows={2}
            value={description}
            maxLength={WA_DEVICE_GROUP_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div
          className="space-y-1 sm:col-span-2"
          aria-live="polite"
          data-testid="groups-numbers-feedback"
        >
          <p className="text-xs text-muted-foreground">
            {t('counted', { count: parsed.valid.length, max: NUMBERS_PER_CALL })}
            {parsed.duplicates > 0 && ` · ${t('duplicates', { count: parsed.duplicates })}`}
          </p>
          {parsed.invalid.length > 0 && (
            <p className="text-xs text-danger" data-testid="groups-numbers-invalid">
              {t('invalid', { numbers: parsed.invalid.join(', ') })}
            </p>
          )}
          {parsed.includesSelf && (
            <p className="text-xs text-muted-foreground">{t('selfIgnored')}</p>
          )}
          {parsed.overCap && (
            <p className="text-xs text-danger" data-testid="groups-numbers-over">
              {t('overCap', { max: NUMBERS_PER_CALL })}
            </p>
          )}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <details className="rounded-md border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{t('readNotice')}</summary>
            <div className="mt-3">
              <RiskNotice version={PERSONAL_WA_NOTICE_VERSION} />
            </div>
          </details>
          <Checkbox
            id={`${id}-ack`}
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            label={t('acknowledge')}
          />
        </div>

        {!online && (
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('offlineHint')}</p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!valid || blocked || create.isPending}>
            {create.isPending ? t('submitting') : t('submit')}
          </Button>
        </div>
      </form>

      {result && sum && (
        <div className="mt-4 space-y-2" data-testid="groups-create-result">
          <p className="text-sm font-medium">
            {t('resultSummary', { ok: sum.ok, failed: sum.failed.length })}
          </p>
          {!result.descriptionSet && (
            <p className="text-xs text-warning">{t('descriptionNotSet')}</p>
          )}
          <OutcomeList results={sum.failed} />
        </div>
      )}
    </Card>
  );
}
