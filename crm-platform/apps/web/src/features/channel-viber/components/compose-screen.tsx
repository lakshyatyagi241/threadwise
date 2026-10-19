'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@crm/ui';
import { VIB_TEXT_MAX } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { UploadMediaButton } from '@/features/broadcasts/components/upload-media-button';
import { ApiError } from '@/lib/api/errors';
import { createBroadcast, KEYS, useCompose, useUsers } from '../api/viber';
import {
  bodyAfterTemplate,
  buttonCount,
  canCreate,
  isAllowedMedia,
  isMediaSizeOk,
} from '../lib/compose-model';
import { BackIcon, VIBER } from './viber-icons';

const UPLOAD_ACCEPT = '.jpg,.jpeg,.png,.gif,.mp4,image/jpeg,image/png,image/gif,video/mp4';

/**
 * `/viber/broadcasts/create` (TW-VIB-012): name, channel, optional template, message, an attachment, and the users to send to. The
 * attachment is a public address; a file can also be uploaded to the workspace's storage (up to 20 MB, below Viber's 26 MB).
 */
export function ComposeScreen() {
  const t = useTranslations('viber.compose');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('viber.broadcasts.manage');
  const compose = useCompose();

  const [name, setName] = useState('');
  const [channelPick, setChannelPick] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaSize, setMediaSize] = useState<number | undefined>();
  // Users ticked per channel: switching the channel swaps the list, so a stale tick never reaches another channel.
  const [picked, setPicked] = useState<Record<string, ReadonlySet<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channels = compose.data?.channels ?? [];
  const templates = compose.data?.templates ?? [];
  const channelId = channelPick || channels[0]?.id || '';
  const users = useUsers(channelId);
  const userList = useMemo(() => users.data?.data ?? [], [users.data]);
  const selected = picked[channelId] ?? new Set<string>();

  const setSelected = (next: Set<string>) => setPicked((p) => ({ ...p, [channelId]: next }));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const allSelected = userList.length > 0 && userList.every((u) => selected.has(u.userId));

  const mediaOk = isAllowedMedia(mediaUrl) && isMediaSizeOk(mediaSize);
  const ready = canCreate({ name, channelId, body, mediaUrl, selected }) && mediaOk;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await createBroadcast({
        name: name.trim(),
        channelId,
        templateId: templateId || undefined,
        body: body.trim() || undefined,
        mediaUrl: mediaUrl.trim() || undefined,
        mediaSize: mediaUrl.trim() ? mediaSize : undefined,
        userIds: [...selected],
      });
      await qc.invalidateQueries({ queryKey: KEYS.broadcasts });
      toast(t('created', { count: made.total }), 'success');
      router.push('/viber/broadcasts');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  if (compose.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex items-center gap-3">
        <Link
          href="/viber/broadcasts"
          aria-label={t('back')}
          title={t('back')}
          className="grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted"
        >
          <BackIcon className="size-4" />
        </Link>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="mt-1 text-[26px] leading-none sm:text-[32px]">
            {t('title')}{' '}
            <span className="italic" style={{ color: VIBER }}>
              {t('titleAccent')}
            </span>
          </h1>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {compose.isError && <Alert tone="danger">{t('loadError')}</Alert>}
      {!canManage && <Alert tone="warning">{t('noPermission')}</Alert>}

      <form
        className="max-w-2xl overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && canManage) void submit();
        }}
      >
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={`${t('name')} *`} htmlFor="viber-bcast-name">
              <Input
                id="viber-bcast-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={191}
                required
                placeholder={t('namePlaceholder')}
              />
            </Field>
            <Field label={t('channel')} htmlFor="viber-bcast-channel">
              <Select
                id="viber-bcast-channel"
                value={channelId}
                onChange={(e) => setChannelPick(e.target.value)}
                className="font-semibold"
              >
                {channels.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {c.name || t('channelFallback', { n: i + 1 })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {templates.length > 0 && (
            <Field label={t('template')} htmlFor="viber-bcast-template">
              <Select
                id="viber-bcast-template"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setBody((b) =>
                    bodyAfterTemplate(
                      b,
                      templates.find((x) => x.id === e.target.value),
                    ),
                  );
                }}
              >
                <option value="">{t('templateNone')}</option>
                {templates.map((x) => {
                  const count = buttonCount(x.buttons);
                  return (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {count > 0 ? ` · ${t('buttonCount', { count })}` : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}

          <Field label={t('message')} htmlFor="viber-bcast-body">
            <Textarea
              id="viber-bcast-body"
              rows={4}
              maxLength={VIB_TEXT_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('messagePlaceholder')}
            />
          </Field>

          <Field
            label={t('attachment')}
            htmlFor="viber-bcast-media"
            hint={t('attachmentHint')}
            error={mediaOk ? undefined : t('attachmentInvalid')}
          >
            <Input
              id="viber-bcast-media"
              type="url"
              value={mediaUrl}
              onChange={(e) => {
                setMediaUrl(e.target.value);
                setMediaSize(undefined);
              }}
              placeholder="https://…/promo.jpg"
              invalid={!mediaOk}
            />
            <div className="mt-1.5">
              <UploadMediaButton
                accept={UPLOAD_ACCEPT}
                onUploaded={(m) => {
                  setMediaUrl(m.url);
                  setMediaSize(m.size);
                }}
              />
            </div>
          </Field>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] font-semibold">{t('recipients')} *</span>
              <button
                type="button"
                className="text-[11px] font-semibold text-success hover:underline"
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(userList.map((u) => u.userId)))
                }
              >
                {allSelected ? t('clearAll') : t('selectAll')}
              </button>
            </div>
            <div className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border">
              {users.isLoading && (
                <div className="flex justify-center p-4">
                  <Spinner />
                </div>
              )}
              {!users.isLoading && userList.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {t('noUsers')}
                </p>
              )}
              {userList.map((u) => (
                <label
                  key={u.userId}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40"
                >
                  <Checkbox
                    id={`viber-user-${u.userId}`}
                    checked={selected.has(u.userId)}
                    onChange={() => toggle(u.userId)}
                    label={<span className="truncate text-[12.5px]">{u.title}</span>}
                  />
                </label>
              ))}
            </div>
            <div className="mt-1 text-[10.5px] text-muted-foreground">
              {t('selected', { count: selected.size })}
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              className="rounded-full px-6 text-white"
              style={{ background: VIBER }}
              disabled={!ready || busy || !canManage}
            >
              {t('submit')}
            </Button>
          </div>
        </div>
      </form>
    </main>
  );
}
