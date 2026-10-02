'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectResult, WabaReadiness } from '@crm/contracts';
import { Alert, Button, Modal, Spinner } from '@crm/ui';
import { useConnectEmbedded } from '../api/hooks';
import type { FbSdk } from '../lib/facebook-sdk';
import { loginOptions } from '../lib/facebook-sdk';
import {
  SESSION_WAIT_MS,
  initialSignup,
  isFacebookOrigin,
  nextSignup,
  parseSignupMessage,
  type SignupEvent,
  type SignupMode,
  type SignupState,
} from '../lib/embedded-signup';
import { useErrorText } from './use-error-text';

interface Props {
  open: boolean;
  onClose: () => void;
  onSwitchManual: () => void;
  onConnected: (result: ConnectResult) => void;
  readiness: WabaReadiness;
  fb: FbSdk | null;
  sdkFailed: boolean;
}

/** WD-WABA-005 / 009: launches Meta's popup and submits once both the login code and the session message are in. */
export function ConnectEmbeddedModal({
  open,
  onClose,
  onSwitchManual,
  onConnected,
  readiness,
  fb,
  sdkFailed,
}: Props) {
  const t = useTranslations('whatsapp-cloud-api-waba.connect');
  const tc = useTranslations('whatsapp-cloud-api-waba.common');
  const errorText = useErrorText();
  const connect = useConnectEmbedded();
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'connecting'>('idle');
  const [message, setMessage] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const signup = useRef<SignupState>(initialSignup());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const feed = useCallback(
    (ev: SignupEvent) => {
      const { state, effect } = nextSignup(signup.current, ev);
      signup.current = state;
      switch (effect.kind) {
        case 'submit':
          clearTimer();
          setPhase('connecting');
          connect.mutate(effect.input, {
            onSuccess: (r) => {
              setPhase('idle');
              onConnected(r);
            },
            onError: (e) => {
              signup.current = initialSignup(state.mode);
              setPhase('idle');
              setMessage({ tone: 'danger', text: errorText(e).text });
            },
          });
          break;
        case 'no-number':
          clearTimer();
          setPhase('idle');
          setMessage({ tone: 'warning', text: t('noNumber') });
          break;
        case 'cancelled':
          clearTimer();
          setPhase('idle');
          setMessage({ tone: 'warning', text: t('cancelled') });
          break;
        case 'error':
          clearTimer();
          setPhase('idle');
          setMessage({
            tone: 'danger',
            text: effect.message
              ? t('metaError', { message: effect.message })
              : t('metaErrorGeneric'),
          });
          break;
        default:
          // The code arrived but the ids have not: give Meta a moment, then say what is wrong.
          if (ev.type === 'code' && !timer.current) {
            timer.current = setTimeout(() => {
              timer.current = null;
              if (!signup.current.submitted) {
                setPhase('idle');
                setMessage({ tone: 'warning', text: t('noSession') });
              }
            }, SESSION_WAIT_MS);
          }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connect.mutate, onConnected, t],
  );

  // Meta's popup reports the chosen WABA and number by postMessage, from facebook.com only.
  useEffect(() => {
    if (!open) return;
    const onMessage = (e: MessageEvent) => {
      if (!isFacebookOrigin(e.origin)) return;
      const parsed = parseSignupMessage(e.data);
      if (parsed) feed({ type: 'session', ...parsed });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, feed]);

  useEffect(() => clearTimer, []);

  const launch = (mode: SignupMode) => {
    if (!readiness.embeddedSignupReady || !readiness.configId) {
      setMessage({ tone: 'danger', text: t('notConfigured') });
      return;
    }
    if (!fb) {
      setMessage({ tone: 'danger', text: t('sdkFailed') });
      return;
    }
    setMessage(null);
    signup.current = initialSignup(mode);
    setPhase('waiting');
    // Not async: the popup has to open synchronously inside the click.
    fb.login(
      (res) => {
        const code = res.authResponse?.code;
        if (code) feed({ type: 'code', code });
        else if (!signup.current.submitted) {
          clearTimer();
          setPhase('idle');
          setMessage({ tone: 'warning', text: t('cancelled') });
        }
      },
      loginOptions({
        configId: readiness.configId,
        solutionId: readiness.solutionId,
        coexistence: mode === 'coexistence',
      }),
    );
  };

  const busy = phase !== 'idle';
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('embeddedTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onSwitchManual} disabled={busy}>
            {t('switchManual')}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('embeddedIntro')}</p>
        {sdkFailed && <Alert tone="danger">{t('sdkFailed')}</Alert>}
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Button
          id="waba-launch-embedded-signup"
          className="w-full"
          variant="brand"
          disabled={busy || !fb}
          onClick={() => launch('standard')}
        >
          {phase === 'connecting' ? (
            <>
              <Spinner /> {t('connecting')}
            </>
          ) : phase === 'waiting' ? (
            <>
              <Spinner /> {t('launching')}
            </>
          ) : (
            t('launch')
          )}
        </Button>
      </div>
    </Modal>
  );
}
