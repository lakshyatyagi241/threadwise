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
import { WECHAT_AUDIENCES, WECHAT_BODY_MAX, type WechatAudience } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { createBroadcast, KEYS, useChats, useCompose } from '../api/wechat';
import { bodyAfterTemplate, canCreate } from '../lib/compose-model';
import { BackIcon, WECHAT_GREEN } from './wechat-icons';

const AUDIENCE_LABEL = {
  all: 'audienceAll',
  tag: 'audienceTag',
  list: 'audienceList',
} as const satisfies Record<WechatAudience, string>;

/**
 * `/wechat/broadcasts/create`: name, channel, audience (all followers, a tag, or people picked from the inbox), an optional template
 * that prefills the message, and the message (plain text, up to 2000 characters).
 */
export function ComposeScreen() {
  const t = useTranslations('wechat.compose');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('wechat.broadcasts.manage');
  const compose = useCompose();

  const [name, setName] = useState('');
  const [channelPick, setChannelPick] = useState('');
  const [audience, setAudience] = useState<WechatAudience>('all');
  const [tagId, setTagId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  // Followers ticked per channel: switching the channel swaps the list, so a stale tick never reaches another channel.
  const [picked, setPicked] = useState<Record<string, ReadonlySet<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channels = compose.data?.channels ?? [];
  const templates = compose.data?.templates ?? [];
  const channelId = channelPick || channels[0]?.id || '';
  const chats = useChats(channelId, audience === 'list');
  const chatList = useMemo(() => chats.data?.data ?? [], [chats.data]);
  const selected = picked[channelId] ?? new Set<string>();

  const toggle = (openid: string) => {
    const next = new Set(selected);
    if (next.has(openid)) next.delete(openid);
    else next.add(openid);
    setPicked((p) => ({ ...p, [channelId]: next }));
  };

  const ready = canCreate({ name, channelId, audience, tagId, body, selected });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createBroadcast({
        name: name.trim(),
        channelId,
        templateId: templateId || undefined,
        body: body.trim(),
        audience,
        tagId: audience === 'tag' ? tagId.trim() : undefined,
        openids: audience === 'list' ? [...selected] : undefined,
      });
      await qc.invalidateQueries({ queryKey: KEYS.broadcasts });
      toast(t('created'), 'success');
      router.push('/wechat/broadcasts');
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
          href="/wechat/broadcasts"
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
            <span className="italic" style={{ color: WECHAT_GREEN }}>
              {t('titleAccent')}
            </span>
          </h1>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {compose.isError && <Alert tone="danger">{t('loadError')}</Alert>}
      {compose.isSuccess && channels.length === 0 && (
        <Alert tone="warning">{t('noChannels')}</Alert>
      )}
      {!canManage && <Alert tone="warning">{t('noPermission')}</Alert>}

      <form
        className="max-w-2xl space-y-4 overflow-hidden rounded-2xl border border-border bg-background p-5 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && canManage) void submit();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t('name')} *`} htmlFor="wc-bcast-name">
            <Input
              id="wc-bcast-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={191}
              required
              placeholder={t('namePlaceholder')}
            />
          </Field>
          <Field label={t('channel')} htmlFor="wc-bcast-channel">
            <Select
              id="wc-bcast-channel"
              value={channelId}
              onChange={(e) => setChannelPick(e.target.value)}
              className="font-semibold"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.accountName || t('channelFallback')}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="text-[11.5px] font-semibold">{t('audience')}</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {WECHAT_AUDIENCES.map((a) => (
              <label
                key={a}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs"
              >
                <input
                  type="radio"
                  name="audience"
                  value={a}
                  checked={audience === a}
                  onChange={() => setAudience(a)}
                />
                {t(AUDIENCE_LABEL[a])}
              </label>
            ))}
          </div>
          {audience === 'tag' && (
            <Input
              aria-label={t('tagLabel')}
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              inputMode="numeric"
              maxLength={10}
              placeholder={t('tagPlaceholder')}
              className="mt-2 w-full font-mono sm:w-52"
            />
          )}
          {audience === 'list' && (
            <>
              <div
                className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border"
                aria-label={t('recipients')}
              >
                {chats.isLoading && (
                  <div className="flex justify-center p-4">
                    <Spinner />
                  </div>
                )}
                {!chats.isLoading && chatList.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t('noChats')}
                  </p>
                )}
                {chatList.map((c) => (
                  <label
                    key={c.openid}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted/40"
                  >
                    <Checkbox
                      id={`chat-${c.openid}`}
                      checked={selected.has(c.openid)}
                      onChange={() => toggle(c.openid)}
                      label={
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: WECHAT_GREEN }}
                          />
                          <span className="truncate text-[12.5px]">{c.title}</span>
                        </span>
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="mt-1 text-[10.5px] text-muted-foreground">
                {t('selected', { count: selected.size })}
              </div>
            </>
          )}
        </fieldset>

        {templates.length > 0 && (
          <Field label={t('template')} htmlFor="wc-bcast-template">
            <Select
              id="wc-bcast-template"
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
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={`${t('message')} *`} htmlFor="wc-bcast-body" hint={t('messageHint')}>
          <Textarea
            id="wc-bcast-body"
            rows={5}
            maxLength={WECHAT_BODY_MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            placeholder={t('messagePlaceholder')}
          />
        </Field>

        <div className="flex justify-end pt-1">
          <Button
            type="submit"
            className="rounded-full px-6 text-white"
            style={{ background: WECHAT_GREEN }}
            disabled={!ready || busy || !canManage}
          >
            {t('submit')}
          </Button>
        </div>
      </form>
    </main>
  );
}
