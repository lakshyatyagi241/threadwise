'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  PasswordInput,
  Spinner,
  Textarea,
  useToast,
} from '@crm/ui';
import {
  parseGetaChatbotRecord,
  type GetaPublishSettings,
  type UpdateGetaPublishSettingsRequest,
} from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useClearGetaSettings, useGetaSettings, useSaveGetaSettings } from './api';

const errText = (e: unknown): string =>
  e instanceof ApiError ? e.message : ((e as Error)?.message ?? '');

/**
 * `/flows/geta-publishing`: where a workspace enters the credentials that let Publish also push the bot live on the Geta console.
 * Secrets are write-only: a saved token shows as "Saved" and an empty box keeps it; the chatbot record shows as a short summary.
 */
export function GetaSettingsScreen() {
  const t = useTranslations('flb.geta.settings');
  const canManage = useCan('flb.geta.manage');
  const q = useGetaSettings();
  return (
    <main className="mx-auto max-w-3xl px-4 py-7 sm:px-6">
      <h1 className="text-3xl font-normal tracking-tight">{t('title')}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      {!canManage && (
        <Alert className="mt-4" tone="info">
          {t('viewOnly')}
        </Alert>
      )}
      {q.isPending && (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={t('loading')} /> {t('loading')}
        </div>
      )}
      {q.isError && (
        <Alert tone="danger" className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <span>
            {t('loadFailed')} {errText(q.error)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      )}
      {q.data && <SettingsForm data={q.data} canManage={canManage} />}
    </main>
  );
}

export function SettingsForm({
  data,
  canManage,
}: {
  data: GetaPublishSettings;
  canManage: boolean;
}) {
  const t = useTranslations('flb.geta.settings');
  const { toast } = useToast();
  const save = useSaveGetaSettings();
  const clear = useClearGetaSettings();
  const [baseUrl, setBaseUrl] = useState(data.baseUrl ?? '');
  const [origin, setOrigin] = useState(data.origin ?? '');
  const [authorization, setAuthorization] = useState('');
  const [getaHost, setGetaHost] = useState('');
  const [record, setRecord] = useState('');
  const [recordError, setRecordError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const busy = save.isPending || clear.isPending;

  /** Only what changed is sent: an untouched secret box keeps the saved value. */
  const buildBody = (): UpdateGetaPublishSettingsRequest => {
    const body: UpdateGetaPublishSettingsRequest = {};
    if (baseUrl.trim() !== (data.baseUrl ?? '')) body.baseUrl = baseUrl.trim() || null;
    if (origin.trim() !== (data.origin ?? '')) body.origin = origin.trim() || null;
    if (authorization.trim()) body.authorization = authorization.trim();
    if (getaHost.trim()) body.getaHost = getaHost.trim();
    if (record.trim()) body.chatbotRecord = record;
    return body;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (record.trim()) {
      const parsed = parseGetaChatbotRecord(record);
      if (!parsed.ok) {
        setRecordError(parsed.message);
        return;
      }
    }
    setRecordError(null);
    const body = buildBody();
    if (Object.keys(body).length === 0) return;
    save.mutate(body, {
      onSuccess: (saved) => {
        setBaseUrl(saved.baseUrl ?? '');
        setOrigin(saved.origin ?? '');
        setAuthorization('');
        setGetaHost('');
        setRecord('');
        toast(t('saved'), 'success');
      },
      onError: (err) => toast(errText(err) || t('saveFailed'), 'danger'),
    });
  };

  /** Clears one stored value on its own. */
  const remove = (patch: UpdateGetaPublishSettingsRequest) =>
    save.mutate(patch, {
      onSuccess: (saved) => {
        setBaseUrl(saved.baseUrl ?? '');
        setOrigin(saved.origin ?? '');
        toast(t('removed'), 'success');
      },
      onError: (err) => toast(errText(err) || t('saveFailed'), 'danger'),
    });

  const ready = data.configured;
  return (
    <form onSubmit={submit} className="mt-6 space-y-5" aria-busy={busy}>
      {data.mode === 'fixture' ? (
        <Alert tone="warning" data-testid="geta-fixture-notice">
          {t('fixtureNotice')}
        </Alert>
      ) : null}

      <Card className="flex flex-wrap items-center gap-2" data-testid="geta-summary">
        <Badge tone={ready ? 'success' : 'neutral'}>{ready ? t('ready') : t('incomplete')}</Badge>
        <span className="text-sm text-muted-foreground">
          {ready ? t('readyNote') : t('incompleteNote')}
        </span>
      </Card>

      <Card className="space-y-4">
        <Field label={t('baseUrl.label')} htmlFor="geta-base-url" hint={t('baseUrl.hint')}>
          <Input
            id="geta-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api-core-sandbox.geta.ai"
            disabled={!canManage}
            autoComplete="off"
            inputMode="url"
          />
        </Field>
        <Field label={t('origin.label')} htmlFor="geta-origin" hint={t('origin.hint')}>
          <Input
            id="geta-origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="https://app-sandbox.geta.ai"
            disabled={!canManage}
            autoComplete="off"
            inputMode="url"
          />
        </Field>
      </Card>

      <Card className="space-y-4">
        <SecretField
          id="geta-authorization"
          label={t('authorization.label')}
          hint={t('authorization.hint')}
          isSet={data.authorizationSet}
          value={authorization}
          onChange={setAuthorization}
          disabled={!canManage}
          onRemove={() => remove({ authorization: null })}
        />
        <SecretField
          id="geta-host"
          label={t('getaHost.label')}
          hint={t('getaHost.hint')}
          isSet={data.getaHostSet}
          value={getaHost}
          onChange={setGetaHost}
          disabled={!canManage}
          onRemove={() => remove({ getaHost: null })}
        />
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t('record.label')}</h2>
          {data.chatbot ? (
            <Badge tone="success">{t('saved')}</Badge>
          ) : (
            <Badge tone="neutral">{t('notSet')}</Badge>
          )}
        </div>
        {data.chatbot ? (
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted px-3 py-2 text-sm"
            data-testid="geta-chatbot-summary"
          >
            <dt className="text-muted-foreground">{t('record.id')}</dt>
            <dd className="break-all font-mono text-xs">{data.chatbot.id}</dd>
            <dt className="text-muted-foreground">{t('record.name')}</dt>
            <dd className="break-words">{data.chatbot.name ?? '-'}</dd>
            <dt className="text-muted-foreground">{t('record.botId')}</dt>
            <dd className="break-all font-mono text-xs">{data.chatbot.botId}</dd>
          </dl>
        ) : null}
        <Field
          label={data.chatbot ? t('record.replace') : t('record.paste')}
          htmlFor="geta-record"
          hint={t('record.hint')}
          error={recordError}
        >
          <Textarea
            id="geta-record"
            rows={8}
            value={record}
            onChange={(e) => {
              setRecord(e.target.value);
              setRecordError(null);
            }}
            placeholder={
              data.chatbot ? t('record.keepPlaceholder') : '{"id": "...", "bot_id": "...", ...}'
            }
            invalid={!!recordError}
            disabled={!canManage}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </Field>
        {data.chatbot && canManage ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => remove({ chatbotRecord: null })}
            disabled={busy}
          >
            {t('record.remove')}
          </Button>
        ) : null}
      </Card>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirmClear(true)}
            disabled={
              busy ||
              (!data.baseUrl && !data.authorizationSet && !data.getaHostSet && !data.chatbot)
            }
          >
            {t('clear')}
          </Button>
        </div>
      ) : null}

      {canManage ? (
        <ConfirmDialog
          open={confirmClear}
          tone="danger"
          title={t('clearConfirm.title')}
          message={t('clearConfirm.message')}
          confirmLabel={t('clearConfirm.confirm')}
          cancelLabel={t('clearConfirm.cancel')}
          busy={clear.isPending}
          onClose={() => setConfirmClear(false)}
          onConfirm={() =>
            clear.mutate(undefined, {
              onSuccess: (saved) => {
                setConfirmClear(false);
                setBaseUrl(saved.baseUrl ?? '');
                setOrigin(saved.origin ?? '');
                setAuthorization('');
                setGetaHost('');
                setRecord('');
                toast(t('cleared'), 'success');
              },
              onError: (err) => {
                setConfirmClear(false);
                toast(errText(err) || t('saveFailed'), 'danger');
              },
            })
          }
        />
      ) : null}
    </form>
  );
}

function SecretField(props: {
  id: string;
  label: string;
  hint: string;
  isSet: boolean;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations('flb.geta.settings');
  return (
    <Field
      label={
        <span className="flex flex-wrap items-center gap-2">
          {props.label}
          <Badge tone={props.isSet ? 'success' : 'neutral'}>
            {props.isSet ? t('saved') : t('notSet')}
          </Badge>
        </span>
      }
      htmlFor={props.id}
      hint={props.isSet ? t('secretKept') : props.hint}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <PasswordInput
            id={props.id}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder={props.isSet ? t('secretPlaceholder') : ''}
            disabled={props.disabled}
            autoComplete="off"
            showLabel={t('show')}
            hideLabel={t('hide')}
          />
        </div>
        {props.isSet && !props.disabled ? (
          <Button size="md" variant="ghost" onClick={props.onRemove}>
            {t('remove')}
          </Button>
        ) : null}
      </div>
    </Field>
  );
}
