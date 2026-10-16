export type ReminderKind = 'renewal_due' | 'payment_failed' | 'ended';

export interface ReminderFacts {
  /** The app's name. */
  name: string;
  /** The end of the paid period (ISO), when the event carries one. */
  date: string | null;
  /** The card renews it at that date. */
  autoRenew: boolean;
  /** It was cancelled: it ends at that date. */
  canceling: boolean;
  /** For a failed renewal: until when the app keeps working (ISO). */
  graceEnds: string | null;
}

export interface ReminderCopy {
  type: 'marketplace_renewal_due' | 'marketplace_payment_failed' | 'marketplace_subscription_ended';
  title: string;
  body: string;
}

/** "13 Nov 2026" in English, in UTC: the server's wording for the row and the email (the web translates the row from its data). */
export function plainDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The English wording of the three subscription notices (the in-app row's `title` and `body`, and the email). Which sentence applies follows
 * what will truly happen: a card that renews says it will be charged and how to stop it, a prepaid month says to pay again, a cancelled
 * subscription says it ends and how to keep it. Pure, so the wording is tested without a database.
 */
export function reminderCopy(kind: ReminderKind, f: ReminderFacts): ReminderCopy {
  const date = plainDate(f.date);
  if (kind === 'payment_failed') {
    const until = plainDate(f.graceEnds) ?? date;
    return {
      type: 'marketplace_payment_failed',
      title: `Payment for ${f.name} failed`,
      body: until
        ? `The card payment for ${f.name} did not go through. The app keeps working until ${until} while the payment provider tries again. Pay now, or fix your payment method, to avoid a pause.`
        : `The card payment for ${f.name} did not go through. The app keeps working while the payment provider tries again. Pay now, or fix your payment method, to avoid a pause.`,
    };
  }
  if (kind === 'ended') {
    return {
      type: 'marketplace_subscription_ended',
      title: `${f.name} subscription ended`,
      body: `The subscription to ${f.name} has ended and the app is paused. Its data and settings are kept. Subscribe again to switch it back on.`,
    };
  }
  const at = date ?? 'the end of the period';
  if (f.canceling)
    return {
      type: 'marketplace_renewal_due',
      title: `${f.name} ends on ${at}`,
      body: `You cancelled ${f.name}, so it stops working on ${at}. Subscribe again before then to keep it.`,
    };
  if (f.autoRenew)
    return {
      type: 'marketplace_renewal_due',
      title: `${f.name} renews on ${at}`,
      body: `Your card will be charged automatically on ${at} to renew ${f.name}. Cancel before then to stop it.`,
    };
  return {
    type: 'marketplace_renewal_due',
    title: `${f.name} is paid until ${at}`,
    body: `${f.name} is paid until ${at} and does not renew by itself. Pay again before then to keep it running without a pause.`,
  };
}
