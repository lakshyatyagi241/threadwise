'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Card, Checkbox, Spinner, Textarea } from '@crm/ui';
import { useAiCrmIndex, useResetAiCrm, useSendAiCrmMessage, useSetAiCrmSettings } from './api/ai-crm-hooks';
import { useErrorText } from './components/use-error-text';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** `/ai-crm` (Reference AI CRM Copilot): a chat surface that runs the CRM by tool-calling, confirm-before-act on writes. */
export function AiCrmScreen() {
  const t = useTranslations('ai-copilot-lead-finder.chat');
  const errorText = useErrorText();
  const index = useAiCrmIndex();
  const send = useSendAiCrmMessage();
  const reset = useResetAiCrm();
  const setSettings = useSetAiCrmSettings();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  // `send.isPending` only flips on the next render, not the instant `mutate()` is called — a ref guard closes
  // that window so two Enter presses in the same tick can't both pass the guard and fire two sends.
  const sendingRef = useRef(false);

  const onSend = () => {
    const message = draft.trim();
    if (!message || sendingRef.current) return;
    sendingRef.current = true;
    setTurns((prev) => [...prev, { role: 'user', text: message }]);
    setDraft('');
    send.mutate(
      { message },
      {
        onSuccess: (res) => {
          sendingRef.current = false;
          setTurns((prev) => [...prev, { role: 'assistant', text: res.reply }]);
        },
        onError: (err) => {
          sendingRef.current = false;
          setTurns((prev) => [...prev, { role: 'assistant', text: errorText(err).text }]);
        },
      },
    );
  };

  const onReset = () => {
    reset.mutate(undefined, { onSuccess: () => setTurns([]) });
  };

  const onToggleWaCopilot = (checked: boolean) => {
    setSettings.mutate({ waCopilotEnabled: checked });
  };

  if (index.isPending) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-sm text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (index.isError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Alert tone="danger">{errorText(index.error).text}</Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onReset} disabled={reset.isPending}>
          {t('resetConversation')}
        </Button>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="flex min-h-[420px] flex-col p-4">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {turns.length === 0 && <p className="text-sm text-muted-foreground">{t('emptyState')}</p>}
            {turns.map((turn, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-sm ${
                  turn.role === 'user' ? 'ms-auto max-w-[80%] bg-primary text-primary-foreground' : 'max-w-[80%] bg-muted'
                }`}
              >
                {turn.text}
              </div>
            ))}
            {send.isPending && (
              <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Spinner /> {t('thinking')}
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder={t('inputPlaceholder')}
              rows={2}
              maxLength={2000}
              className="flex-1"
            />
            <Button onClick={onSend} disabled={send.isPending || draft.trim() === ''}>
              {t('send')}
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('recentActions')}</h2>
            {index.data.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noRecentActions')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {index.data.recent.map((a, i) => (
                  <li key={i} className="border-b border-border pb-2 last:border-0 last:pb-0">
                    <div className="font-medium">{a.tool}</div>
                    <div className="text-muted-foreground">{a.summary}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {index.data.canManageSettings && (
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">{t('settings.title')}</h2>
              {setSettings.isSuccess && <Alert tone="success">{t('notice.settingsSaved')}</Alert>}
              {setSettings.isError && <Alert tone="danger">{errorText(setSettings.error).text}</Alert>}
              <Checkbox
                checked={index.data.waCopilotEnabled}
                onChange={(e) => onToggleWaCopilot(e.target.checked)}
                disabled={setSettings.isPending}
                label={t('settings.waCopilotToggle')}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
