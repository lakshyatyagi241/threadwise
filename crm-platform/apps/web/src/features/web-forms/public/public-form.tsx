'use client';

import type { PublicForm as PublicFormData } from '@crm/contracts';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCaptcha } from '@/features/auth-registration-security/guest/captcha';
import { FormRenderer, type CaptchaSlot } from '../components/form-renderer';
import { resizeMessage } from '../lib/share';
import { newIdempotencyKey } from '../lib/submit';
import { sendEvent, submitForm } from './api';

/**
 * The hosted page and the embedded frame (`/f/<key>`, `/f/<key>?embed=1`): the shared renderer plus what only a live page does:
 * send the submission through the same-origin relay, count visits with the analytics beacon, run the CAPTCHA the form asks for
 * and, in a frame, tell the host page how tall the form is. The frame only ever SENDS messages: it never listens, so a host
 * page cannot steer it (spec section 7.3).
 */
export function PublicForm({ form, embed }: { form: PublicFormData; embed: boolean }) {
  const visitId = useRef<string>('');
  const captchaConfig = useMemo(
    () =>
      form.captcha.required && form.captcha.version && form.captcha.siteKey
        ? { version: form.captcha.version, siteKey: form.captcha.siteKey }
        : null,
    [form.captcha],
  );
  const gate = useCaptcha(captchaConfig, 'form');
  const captcha: CaptchaSlot = {
    enabled: gate.enabled,
    widget: gate.widget,
    token: gate.token,
    needsInteraction: gate.needsInteraction,
  };

  useEffect(() => {
    visitId.current = newIdempotencyKey();
    sendEvent(form.key, { visitId: visitId.current, kind: 'view' });
  }, [form.key]);

  const post = useCallback(
    (
      message:
        | ReturnType<typeof resizeMessage>
        | { source: 'forms'; type: 'submitted' | 'redirect'; key: string; url?: string },
    ) => {
      // `*`: the host's origin is not known to the frame and the message carries nothing but a height, the key and a URL the form's
      // own settings allow. The loader checks `event.origin` and `event.source` before it acts.
      if (embed && window.parent !== window) window.parent.postMessage(message, '*');
    },
    [embed],
  );

  const onEvent = useCallback(
    (kind: 'start' | 'step' | 'submit' | 'complete', step?: number) => {
      if (visitId.current)
        sendEvent(form.key, {
          visitId: visitId.current,
          kind,
          ...(step !== undefined ? { step } : {}),
        });
    },
    [form.key],
  );

  return (
    <>
      {embed && <style>{'html,body{background:transparent!important}'}</style>}
      <FormRenderer
        form={form}
        mode="live"
        embed={embed}
        honeypotField={form.honeypotField}
        captcha={captcha}
        poweredBy={form.poweredBy.show ? form.poweredBy.label : null}
        onSubmit={(payload) => submitForm(form.key, payload)}
        onEvent={onEvent}
        onSubmitted={() => post({ source: 'forms', type: 'submitted', key: form.key })}
        // On a hosted page the renderer navigates itself; in a frame the host's loader does it, for https addresses only.
        onRedirect={
          embed
            ? (url) => post({ source: 'forms', type: 'redirect', key: form.key, url })
            : undefined
        }
        onResize={embed ? (h) => post(resizeMessage(form.key, h)) : undefined}
      />
    </>
  );
}
