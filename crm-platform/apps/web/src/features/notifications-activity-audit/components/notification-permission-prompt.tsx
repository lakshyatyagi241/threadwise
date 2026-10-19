'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Alert, Button } from '@crm/ui';
import { askedThisSession, rememberAskedThisSession } from '../push/client';
import { isAwaitingAnswer } from '../push/support';
import { useBrowserPush, usePushDeployment } from '../push/use-browser-push';

/**
 * Asks a signed-in person to allow browser notifications while they still have not answered the browser: right after sign-up
 * (onboarding) and on every page of the app after that. The page asks the browser itself once per browser tab session (browsers
 * that ignore a prompt without a click leave the banner's button), and the banner stays until the person answers. A refusal ends
 * the banner; the Settings card then says how to change it in the browser. Nothing renders when the deployment has no push keys or
 * the browser cannot show notifications.
 */
export function NotificationPermissionPrompt() {
  const deployment = usePushDeployment();
  if (deployment.loading || !deployment.configured) return null;
  return <PromptConfigured />;
}

function PromptConfigured() {
  const t = useTranslations('notifications.prefs.push.prompt');
  const push = useBrowserPush({ devices: false });
  const awaiting = isAwaitingAnswer(push.state, push.permission);
  const { enable } = push;

  // The one automatic ask: as soon as the page knows the person still has to answer. `asked` stops a second run within this mount (the
  // effect re-runs when `enable` changes identity while busy). The session flag is written once the browser has answered or refused to
  // show its prompt, so a prompt cut off by a reload is asked again, and an ignored one is not repeated on every page; the banner's
  // button is always there to ask again.
  const asked = useRef(false);
  useEffect(() => {
    if (!awaiting || asked.current) return;
    asked.current = true;
    if (askedThisSession()) return;
    void enable().finally(rememberAskedThisSession);
  }, [awaiting, enable]);

  if (!awaiting) return null;
  return (
    <Alert
      tone="info"
      className="flex flex-wrap items-center justify-between gap-3"
      data-testid="notification-permission-prompt"
    >
      <span>{t('message')}</span>
      <Button onClick={() => void enable()} disabled={push.busy !== null}>
        {push.busy === 'enable' ? t('enabling') : t('enable')}
      </Button>
    </Alert>
  );
}
