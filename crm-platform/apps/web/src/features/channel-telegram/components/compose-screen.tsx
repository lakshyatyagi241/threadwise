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
import { ApiError } from '@/lib/api/errors';
import { createBroadcast, KEYS, useChats, useCompose } from '../api/telegram';
import {
  bodyAfterTemplate,
  buttonLabels,
  canCreate,
  isHttpUrl,
  previewText,
} from '../lib/compose-model';
import { BackIcon } from './tg-icons';
import { UploadMediaButton } from '@/features/broadcasts/components/upload-media-button';

const TG = '#229ED9';

/**
 * `/telegram/broadcasts/create` (TW-TG-012): name, bot, optional template, message with a live preview, an attachment, and the
 * chats to send to. The attachment is a public address for now: uploading a file waits on the storage service.
 */
export function ComposeScreen() {
  const t = useTranslations('telegram.compose');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('tg.broadcasts.manage');
  const compose = useCompose();

  const [name, setName] = useState('');
  const [botPick, setBotPick] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  // Chats ticked per bot: switching the bot swaps the list, so a stale tick never reaches another bot.
  const [picked, setPicked] = useState<Record<string, ReadonlySet<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bots = compose.data?.bots ?? [];
  const templates = compose.data?.templates ?? [];
  const botId = botPick || bots[0]?.id || '';
  const chats = useChats(botId);
  const chatList = useMemo(() => chats.data?.data ?? [], [chats.data]);
  const selected = picked[botId] ?? new Set<string>();
  const template = templates.find((x) => x.id === templateId);

  const setSelected = (next: Set<string>) => setPicked((p) => ({ ...p, [botId]: next }));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const allSelected = chatList.length > 0 && chatList.every((c) => selected.has(c.chatId));

  const mediaOk = mediaUrl.trim() === '' || isHttpUrl(mediaUrl.trim());
  const ready = canCreate({ name, botId, body, mediaUrl, selected }) && mediaOk;
  const labels = buttonLabels(template?.buttons);
  const shown = previewText(body);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await createBroadcast({
        name: name.trim(),
        botId,
        templateId: templateId || undefined,
        body: body.trim() || undefined,
        mediaUrl: mediaUrl.trim() || undefined,
        chatIds: [...selected],
      });
      await qc.invalidateQueries({ queryKey: KEYS.broadcasts });
      toast(t('created', { count: made.total }), 'success');
      router.push('/telegram/broadcasts');
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
          href="/telegram/broadcasts"
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
            {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
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
            <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-background font-mono text-[10px] font-semibold text-brand">
              01
            </span>
            <span className="flex-1 text-lg leading-none">{t('setup')}</span>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={`${t('name')} *`} htmlFor="tg-bcast-name">
                <Input
                  id="tg-bcast-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={191}
                  required
                  placeholder={t('namePlaceholder')}
                />
              </Field>
              <Field label={t('bot')} htmlFor="tg-bcast-bot">
                <Select
                  id="tg-bcast-bot"
                  value={botId}
                  onChange={(e) => setBotPick(e.target.value)}
                  className="font-semibold"
                >
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || `@${(b.username ?? '').replace(/^@/, '')}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {templates.length > 0 && (
              <Field label={t('template')} htmlFor="tg-bcast-template" hint={t('templateHint')}>
                <Select
                  id="tg-bcast-template"
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
                    const count = buttonLabels(x.buttons).length;
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

            <Field label={`${t('message')} *`} htmlFor="tg-bcast-body" hint={t('messageHint')}>
              <Textarea
                id="tg-bcast-body"
                rows={5}
                maxLength={4096}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('messagePlaceholder')}
              />
              {labels.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {labels.map((l) => (
                    <span
                      key={l}
                      className="rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px]"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </Field>

            <Field
              label={t('attachment')}
              htmlFor="tg-bcast-media"
              hint={t('attachmentHint')}
              error={mediaOk ? undefined : t('attachmentInvalid')}
            >
              <Input
                id="tg-bcast-media"
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://…/promo.png"
                invalid={!mediaOk}
              />
              <div className="mt-1.5">
                <UploadMediaButton onUploaded={(m) => setMediaUrl(m.url)} />
              </div>
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11.5px] font-semibold">{t('recipients')} *</span>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-brand hover:underline"
                  onClick={() =>
                    setSelected(allSelected ? new Set() : new Set(chatList.map((c) => c.chatId)))
                  }
                >
                  {allSelected ? t('clearAll') : t('selectAll')}
                </button>
              </div>
              <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {chats.isLoading && (
                  <div className="flex justify-center p-4">
                    <Spinner />
                  </div>
                )}
                {!chats.isLoading && chatList.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">{t('noChats')}</p>
                )}
                {chatList.map((c) => (
                  <label
                    key={c.chatId}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40"
                  >
                    <Checkbox
                      id={`chat-${c.chatId}`}
                      checked={selected.has(c.chatId)}
                      onChange={() => toggle(c.chatId)}
                      label={
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium">{c.title}</span>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9.5px] uppercase text-muted-foreground">
                            {t(
                              `type.${c.type === 'private' || c.type === 'group' ? c.type : 'channel'}`,
                            )}
                          </span>
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
                style={{ background: TG }}
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
                style={{ color: '#1B7CB0' }}
              >
                <span className="size-1.5 rounded-full" style={{ background: TG }} />
                Telegram
              </span>
            </div>
            <div className="p-4" style={{ background: '#cfe0ec' }}>
              <div className="ms-auto max-w-[280px]">
                <div
                  className="rounded-2xl rounded-se-md px-3.5 py-2.5 shadow-sm"
                  style={{ background: '#eeffde', color: '#111' }}
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
                  {labels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {labels.map((l) => (
                        <span
                          key={l}
                          className="rounded-lg px-2.5 py-1 text-[11px]"
                          style={{ background: 'rgba(34,158,217,.15)', color: '#1B7CB0' }}
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-end font-mono text-[9.5px] opacity-60">12:00 ✓✓</div>
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
