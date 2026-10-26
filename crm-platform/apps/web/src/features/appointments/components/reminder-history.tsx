'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppointmentReminder } from '../api/schemas';
import { formatDateTime } from '../lib/format';
import { attemptsToShow, deliveryToShow, fallbackChannel } from '../lib/reminder-history';
import { knownReason } from '../lib/reminder-rules';

/**
 * Under a reminder in the appointment drawer: which channels it tried and why, whether it went by the fallback, what the provider
 * reported and which buttons the customer tapped. Codes in, sentences out; nothing here holds an address, a number or a message.
 */
export function ReminderHistory({
  reminder: r,
  zone,
}: {
  reminder: AppointmentReminder;
  zone: string;
}) {
  const t = useTranslations('appointments.reminders');
  const locale = useLocale();
  const attempts = attemptsToShow(r);
  const fallback = fallbackChannel(r);
  const delivery = deliveryToShow(r);
  if (attempts.length === 0 && !fallback && !delivery && r.buttonReplies.length === 0) return null;
  const channelName = (c: string) =>
    c === 'whatsapp' || c === 'email' || c === 'voice' ? t(`channels.${c}`) : c.toUpperCase();
  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground" data-testid="reminder-history">
      {fallback && <p>{t('history.fallback', { channel: channelName(fallback) })}</p>}
      {delivery && <p>{t(`history.delivery.${delivery}`)}</p>}
      {attempts.length > 0 && (
        <div>
          <p className="font-medium">{t('history.tried')}</p>
          <ol className="ms-4 list-decimal">
            {attempts.map((a, i) => {
              const reason = knownReason(a.reason);
              return (
                <li key={`${a.channel}:${i}`}>
                  {channelName(a.channel)}: {t(`history.attempt.${a.status}`)}
                  {reason ? `. ${t(`reasons.${reason}`)}` : ''}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {r.buttonReplies.length > 0 && (
        <div>
          <p className="font-medium">{t('history.buttons')}</p>
          <ul className="ms-4 list-disc">
            {r.buttonReplies.map((b) => (
              <li key={b.action}>
                {t(`history.button.${b.action}`)} · {formatDateTime(b.at, locale, zone)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
