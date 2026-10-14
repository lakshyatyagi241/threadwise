'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Modal, PasswordInput, Select, useToast } from '@crm/ui';
import { WECHAT_ENC_MODES, type WechatChannel, type WechatEncMode } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { connectChannel, KEYS } from '../api/wechat';
import { connectErrors, type ConnectDraft } from '../lib/connect-model';
import { CopyField } from './copy-field';
import { WECHAT_GREEN, WechatBadge } from './wechat-icons';

const EMPTY: ConnectDraft = {
  accountName: '',
  appId: '',
  appSecret: '',
  verifyToken: '',
  encodingAesKey: '',
  encMode: 'compat',
};

/**
 * "Connect WeChat": paste the AppID, AppSecret and Token (and the EncodingAESKey for safe mode). WeChat proves the credentials; the
 * channel is saved and the person is shown the address and the Token to paste into the WeChat console, because WeChat has no API
 * to set them.
 */
export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('wechat.connect');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<ConnectDraft>(EMPTY);
  const [errors, setErrors] = useState<ReturnType<typeof connectErrors>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ channel: WechatChannel; token: string } | null>(null);

  const set = <K extends keyof ConnectDraft>(k: K, v: ConnectDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const close = () => {
    setDraft(EMPTY);
    setErrors({});
    setError(null);
    setSaved(null);
    onClose();
  };

  const submit = async () => {
    const found = connectErrors(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const channel = await connectChannel({
        appId: draft.appId.trim(),
        appSecret: draft.appSecret.trim(),
        verifyToken: draft.verifyToken.trim(),
        encodingAesKey: draft.encodingAesKey.trim() || undefined,
        encMode: draft.encMode,
        accountName: draft.accountName.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: KEYS.all });
      toast(t('connected'), 'success');
      setSaved({ channel, token: draft.verifyToken.trim() });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  const err = (f: keyof typeof errors) => (errors[f] ? t(errors[f]) : null);

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      closeLabel={t('close')}
      title={
        <span className="flex items-center gap-2.5">
          <WechatBadge className="size-8 text-[12px]" />
          {t('title')}
        </span>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          {saved ? (
            <Button
              className="rounded-full text-white"
              style={{ background: WECHAT_GREEN }}
              onClick={close}
            >
              {t('done')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" className="rounded-full" onClick={close}>
                {t('cancel')}
              </Button>
              <Button
                className="rounded-full text-white"
                style={{ background: WECHAT_GREEN }}
                disabled={busy}
                onClick={() => void submit()}
              >
                {t('submit')}
              </Button>
            </>
          )}
        </div>
      }
    >
      {saved ? (
        <div className="space-y-4">
          <Alert tone="success">{t('connected')}</Alert>
          <PasteBox url={saved.channel.webhookUrl} token={saved.token} />
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label={t('accountName')} htmlFor="wc-name">
            <Input
              id="wc-name"
              value={draft.accountName}
              onChange={(e) => set('accountName', e.target.value)}
              maxLength={191}
              placeholder={t('accountNamePlaceholder')}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('appId')} htmlFor="wc-app-id" error={err('appId')}>
              <Input
                id="wc-app-id"
                value={draft.appId}
                onChange={(e) => set('appId', e.target.value)}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                invalid={errors.appId !== undefined}
                placeholder={t('appIdPlaceholder')}
                className="font-mono"
              />
            </Field>
            <Field label={t('appSecret')} htmlFor="wc-app-secret" error={err('appSecret')}>
              <PasswordInput
                id="wc-app-secret"
                value={draft.appSecret}
                onChange={(e) => set('appSecret', e.target.value)}
                maxLength={128}
                autoComplete="new-password"
                spellCheck={false}
                invalid={errors.appSecret !== undefined}
                showLabel={t('appSecretShow')}
                hideLabel={t('appSecretHide')}
                placeholder="••••••••"
                className="font-mono"
              />
            </Field>
          </div>
          <Field label={t('verifyToken')} htmlFor="wc-token" error={err('verifyToken')}>
            <Input
              id="wc-token"
              value={draft.verifyToken}
              onChange={(e) => set('verifyToken', e.target.value)}
              maxLength={128}
              autoComplete="off"
              spellCheck={false}
              invalid={errors.verifyToken !== undefined}
              placeholder={t('verifyTokenPlaceholder')}
              className="font-mono"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('encodingAesKey')} htmlFor="wc-aes" error={err('encodingAesKey')}>
              <Input
                id="wc-aes"
                value={draft.encodingAesKey}
                onChange={(e) => set('encodingAesKey', e.target.value)}
                autoComplete="off"
                spellCheck={false}
                invalid={errors.encodingAesKey !== undefined}
                placeholder={t('encodingAesKeyPlaceholder')}
                className="font-mono"
              />
            </Field>
            <Field label={t('encMode')} htmlFor="wc-mode">
              <Select
                id="wc-mode"
                value={draft.encMode}
                onChange={(e) => set('encMode', e.target.value as WechatEncMode)}
              >
                {WECHAT_ENC_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`mode.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** The two things to paste into the WeChat console. */
export function PasteBox({ url, token }: { url: string; token: string }) {
  const t = useTranslations('wechat.channel');
  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-muted/50 p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {t('pasteTitle')}
      </div>
      <CopyField label={t('url')} value={url} />
      <CopyField label={t('token')} value={token} />
    </div>
  );
}
