import { clipPreview, isChatType, notificationText, type Translator } from '../lib/copy';
import type { LiveAlert } from './model';

/**
 * The words of the live alerts. The toast and the screen-reader announcement use the same text as the bell row (so a person who
 * hears it and then opens the bell reads the same thing); the desktop alert names the contact only, because it can show on a
 * locked screen (decision D4).
 */

/** Title and body of a toast, an announcement and a bell row for one alert. The body is cut to the preview length. */
export function alertText(t: Translator, alert: LiveAlert): { title: string; body: string | null } {
  const { title, body } = notificationText(t, alert.row);
  const clipped = body ? clipPreview(body) : '';
  return { title, body: clipped || null };
}

/** What a screen reader hears: the one alert in full, or a count when several came at once. */
export function announcementText(t: Translator, alerts: readonly LiveAlert[]): string {
  if (alerts.length === 0) return '';
  if (alerts.length > 1) return t('live.announceMany', { count: alerts.length });
  const { title, body } = alertText(t, alerts[0]!);
  return body ? `${title}. ${body}` : title;
}

/** The desktop alert: the contact's name as the title and what kind of event it is as the body, never the message text. */
export function desktopText(t: Translator, alert: LiveAlert): { title: string; body: string } {
  const name =
    typeof alert.row.data?.contactName === 'string' ? alert.row.data.contactName.trim() : '';
  const kindKey = `live.desktop.${alert.type}`;
  const kind = isChatType(alert.type) && t.has(kindKey) ? t(kindKey) : '';
  const fallback = t('live.desktop.fallbackTitle');
  return { title: name || kind || fallback, body: name ? kind : '' };
}

/** The tag that makes a chat replace its own earlier desktop alert instead of stacking. */
export function desktopTag(alert: LiveAlert): string {
  return `${alert.type}:${alert.subject}`;
}
