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
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { UploadMediaButton } from '@/features/broadcasts/components/upload-media-button';
import { ApiError } from '@/lib/api/errors';
import { createBroadcast, KEYS, useAudience, useCompose } from '../api/line';
import {
  bodyAfterTemplate,
  buttonChips,
  canCreate,
  isHttpUrl,
  previewText,
  toggled,
} from '../lib/compose-model';
import { BackIcon, LINE_GREEN } from './line-icons';

/**
 * `/line/broadcasts/create`: name, channel, optional template, message with a live preview, an attachment, and the people to send to.
 * The attachment is a public address or a file uploaded to the workspace's storage; LINE fetches it over https.
 */
export function ComposeScreen() {
  const t = useTranslations('line.compose');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('line.broadcasts.manage');
  const compose = useCompose();

  const [name, setName] = useState('');
  const [channelPick, setChannelPick] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  // People ticked per channel: switching the channel swaps the list, so a stale tick never reaches another channel.
  const [picked, setPicked] = useState<Record<string, ReadonlySet<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channels = compose.data?.channels ?? [];
  const templates = compose.data?.templates ?? [];
  const channelId = channelPick || channels[0]?.id || '';
  const audience = useAudience(channelId);
  const users = useMemo(() => audience.data?.data ?? [], [audience.data]);
  const selected = picked[channelId] ?? new Set<string>();
  const template = templates.find((x) => x.id === templateId);

  const setSelected = (next: Set<string>) => setPicked((p) => ({ ...p, [channelId]: next }));
  const allSelected = users.length > 0 && users.every((u) => selected.has(u.userId));

  const mediaOk = mediaUrl.trim() === '' || isHttpUrl(mediaUrl.trim());
  const ready = canCreate({ name, channelId, body, mediaUrl, selected }) && mediaOk;
  const chips = buttonChips(template?.buttons);
  const shown = previewText(body);

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
        userIds: [...selected],
      });
      await qc.invalidateQueries({ queryKey: KEYS.broadcasts });
      toast(t('created', { count: made.total }), 'success');
      router.push('/line/broadcasts');
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
          href="/line/broadcasts"
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
            <span className="italic" style={{ color: LINE_GREEN }}>
              {t('titleAccent')}
            </span>
          </h1>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {compose.isError && <Alert tone="danger">{t('loadError')}</Alert>}
      {!canManage && <Alert tone="warning">{t('noPermission')}</Alert>}

      <form
        className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_360px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && canManage) void submit();
        }}
      >
        <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-5 py-4">
            <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-background font-mono text-[10px] font-semibold text-success">
              01
            </span>
            <span className="flex-1 text-lg leading-none">{t('setup')}</span>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={`${t('name')} *`} htmlFor="line-bcast-name">
                <Input
                  id="line-bcast-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={191}
                  required
                  placeholder={t('namePlaceholder')}
                />
              </Field>
              <Field label={t('channel')} htmlFor="line-bcast-channel">
                <Select
                  id="line-bcast-channel"
                  value={channelId}
                  onChange={(e) => setChannelPick(e.target.value)}
                  className="font-semibold"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName || c.basicId || 'LINE'}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {templates.length > 0 && (
              <Field label={t('template')} htmlFor="line-bcast-template" hint={t('templateHint')}>
                <Select
                  id="line-bcast-template"
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
                    const count = buttonChips(x.buttons).length;
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

            <Field label={`${t('message')} *`} htmlFor="line-bcast-body" hint={t('messageHint')}>
              <Textarea
                id="line-bcast-body"
                rows={5}
                maxLength={5000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('messagePlaceholder')}
              />
              {chips.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c.label}
                      className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[10.5px]"
                    >
                      {c.link ? '🔗' : '↩'} {c.label}
                    </span>
                  ))}
                </div>
              )}
            </Field>

            <Field
              label={t('attachment')}
              htmlFor="line-bcast-media"
              hint={t('attachmentHint')}
              error={mediaOk ? undefined : t('attachmentInvalid')}
            >
              <Input
                id="line-bcast-media"
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://…/promo.png"
                invalid={!mediaOk}
              />
              <div className="mt-1.5">
                <UploadMediaButton
                  accept="image/*,video/mp4,video/quicktime,audio/*"
                  onUploaded={(m) => setMediaUrl(m.url)}
                />
              </div>
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11.5px] font-semibold">{t('recipients')} *</span>
                <button
                  type="button"
                  className="text-[11px] font-semibold hover:underline"
                  style={{ color: LINE_GREEN }}
                  onClick={() =>
                    setSelected(allSelected ? new Set() : new Set(users.map((u) => u.userId)))
                  }
                >
                  {allSelected ? t('clearAll') : t('selectAll')}
                </button>
              </div>
              <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {audience.isLoading && (
                  <div className="flex justify-center p-4">
                    <Spinner />
                  </div>
                )}
                {!audience.isLoading && users.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">{t('noUsers')}</p>
                )}
                {users.map((u) => (
                  <label
                    key={u.userId}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40"
                  >
                    <Checkbox
                      id={`line-user-${u.userId}`}
                      checked={selected.has(u.userId)}
                      onChange={() => setSelected(toggled(selected, u.userId))}
                      label={
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: LINE_GREEN }}
                          />
                          <span className="truncate text-[12.5px]">{u.title || t('unnamed')}</span>
                        </span>
                      }
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
                style={{ background: LINE_GREEN }}
                disabled={!ready || busy || !canManage}
              >
                {t('submit')}
              </Button>
            </div>
          </div>
        </section>

        <aside className="xl:sticky xl:top-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('preview')}
              </span>
              <span
                className="inline-flex items-center gap-1.5 font-mono text-[10.5px]"
                style={{ color: '#0B8043' }}
              >
                <span className="size-1.5 rounded-full" style={{ background: LINE_GREEN }} />
                LINE
              </span>
            </div>
            <div className="p-4" style={{ background: '#8CABD8' }}>
              <div className="ms-auto max-w-[280px]">
                <div
                  className="rounded-2xl rounded-se-md px-3.5 py-2.5 shadow-sm"
                  style={{ background: '#9DE24F', color: '#111' }}
                >
                  {mediaUrl.trim() !== '' && (
                    <div className="mb-1.5 break-all font-mono text-[11px] opacity-70">
                      📎 {mediaUrl.trim().split('/').pop()}
                    </div>
                  )}
                  <div
                    className={`whitespace-pre-wrap break-words text-[13px] leading-snug ${shown === '' ? 'opacity-40' : ''}`}
                  >
                    {shown === '' ? t('previewEmpty') : shown}
                  </div>
                  {chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {chips.map((c) => (
                        <span
                          key={c.label}
                          className="rounded-full px-2 py-0.5 text-[10.5px]"
                          style={{
                            background: c.link ? '#EAF9F0' : 'rgba(255,255,255,.6)',
                            color: c.link ? '#0B8043' : '#444',
                          }}
                        >
                          {c.link ? '🔗' : '↩'} {c.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-end font-mono text-[9.5px] opacity-60">12:00</div>
                </div>
              </div>
            </div>
            <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
              {t('previewNote')}
            </div>
          </div>
        </aside>
      </form>
    </main>
  );
}
