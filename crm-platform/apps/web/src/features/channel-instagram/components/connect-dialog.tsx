'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, useToast } from '@crm/ui';
import type { IgAvailableAccount, LinkIgAccountInput } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { fetchAvailable, startConnect } from '../api/instagram';
import { LOOKUP_MS, POPUP_FEATURES, handleOf, planConnect } from '../lib/accounts-model';
import { InstagramGlyph, PlusIcon } from './ig-icons';

/**
 * "Add an Instagram account" (WD-IG-002). One smart button: an account the person already owns on the engine is linked at once,
 * several are offered in a picker, and none (or an engine that does not answer within four seconds) opens the engine's sign-in
 * popup. The popup tells the hub when it is done; the hub links the account it names.
 */
export function ConnectDialog({
  open,
  engine,
  onClose,
  onLink,
}: {
  open: boolean;
  /** The saved display name of the engine ("IgDesk" by default). */
  engine: string;
  onClose: () => void;
  /** Links an account and resolves when it is linked; the hub shows the toast and refreshes. */
  onLink: (input: LinkIgAccountInput) => Promise<void>;
}) {
  const t = useTranslations('instagram.dialog');
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [picker, setPicker] = useState<IgAvailableAccount[] | null>(null);

  const close = () => {
    setPicker(null);
    setBusy(false);
    setChecking(false);
    onClose();
  };

  const link = async (a: IgAvailableAccount) => {
    setBusy(true);
    try {
      await onLink({
        instaflowAccountId: a.id,
        username: a.username,
        name: a.name,
        avatar: a.avatar,
      });
      close();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('linkFailed'), 'danger');
      setBusy(false);
    }
  };

  const connectNew = async () => {
    setBusy(true);
    try {
      const { url } = await startConnect();
      window.open(url, '_blank', POPUP_FEATURES);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('startFailed'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const smartConnect = async () => {
    setChecking(true);
    // The lookup is bounded so the button never hangs on a slow engine: past the limit the popup opens, which is the right action
    // for a fresh connect anyway.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOOKUP_MS);
    let found: IgAvailableAccount[] | null = null;
    try {
      found = (await fetchAvailable(ctrl.signal)).data;
    } catch {
      found = null;
    }
    clearTimeout(timer);
    setChecking(false);

    const plan = planConnect(found);
    if (plan.kind === 'link') await link(plan.account);
    else if (plan.kind === 'pick') setPicker(plan.accounts);
    else await connectNew();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      closeLabel={t('close')}
      eyebrow={t('kicker')}
      title={t('title')}
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-border bg-muted px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {t('note', { engine })}
        </p>

        <button
          type="button"
          disabled={busy || checking}
          onClick={() => void smartConnect()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          <InstagramGlyph className="size-4" />
          {checking ? t('checking') : t('connect')}
        </button>
        <p className="-mt-1.5 text-center text-[11px] text-muted-foreground">
          {t('hint', { engine })}
        </p>

        {picker && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('pick')}
            </div>
            {picker.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-2.5"
              >
                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                  {a.avatar ? (
                    <img
                      src={a.avatar}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="size-full object-cover"
                    />
                  ) : (
                    <InstagramGlyph className="size-4 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold">
                    {a.name || handleOf(a.username, a.name)}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {handleOf(a.username, a.name)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void link(a)}
                  className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {t('link')}
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => void connectNew()}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand hover:underline disabled:opacity-60"
            >
              <PlusIcon className="size-3" />
              {t('connectDifferent')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
