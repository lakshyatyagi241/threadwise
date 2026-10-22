import { promises as dns } from 'node:dns';
import type { RegistrationSettings } from '@crm/contracts';

/** Mailbox providers anyone can open for free: not a company address. */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'yahoo.in',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'zoho.com',
  'zohomail.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'mail.com',
  'email.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'inbox.ru',
  'bk.ru',
  'list.ru',
  'rediffmail.com',
  'rediff.com',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'web.de',
  'libero.it',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'laposte.net',
  't-online.de',
  'btinternet.com',
  'sky.com',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'cox.net',
  'fastmail.com',
  'hushmail.com',
  'tutanota.com',
  'tuta.io',
  'tutamail.com',
  'rambler.ru',
  'seznam.cz',
  'wp.pl',
  'o2.pl',
  'interia.pl',
  'terra.com.br',
  'uol.com.br',
  'bol.com.br',
  'ig.com.br',
]);

/** Throwaway / temporary mailbox services. Matched on the domain and every parent of it. */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamail.biz',
  'guerrillamail.de',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'pokemail.net',
  'spam4.me',
  '10minutemail.com',
  '10minutemail.net',
  '10minutemail.org',
  '10minemail.com',
  '20minutemail.com',
  'temp-mail.org',
  'temp-mail.io',
  'tempmail.com',
  'tempmail.net',
  'tempmail.dev',
  'tempmailo.com',
  'tempail.com',
  'tempinbox.com',
  'tempr.email',
  'throwawaymail.com',
  'throwaway.email',
  'yopmail.com',
  'yopmail.net',
  'yopmail.fr',
  'cool.fr.nf',
  'jetable.fr.nf',
  'nospam.ze.tc',
  'trashmail.com',
  'trashmail.net',
  'trashmail.de',
  'trashmail.io',
  'trash-mail.com',
  'wegwerfmail.de',
  'dispostable.com',
  'getnada.com',
  'nada.email',
  'maildrop.cc',
  'mailnesia.com',
  'mailcatch.com',
  'fakeinbox.com',
  'fakemail.net',
  'fakemailgenerator.com',
  'emailondeck.com',
  'mohmal.com',
  'mintemail.com',
  'mytemp.email',
  'mailtemp.net',
  'moakt.com',
  'moakt.cc',
  'tmpmail.org',
  'tmpmail.net',
  'tmail.ws',
  'burnermail.io',
  'spamgourmet.com',
  'spambox.us',
  'spamex.com',
  'spamfree24.org',
  'mailexpire.com',
  'mailforspam.com',
  'mailnull.com',
  'mailsac.com',
  'mail-temporaire.fr',
  'inboxbear.com',
  'inboxkitten.com',
  'discard.email',
  'discardmail.com',
  'dropmail.me',
  'emailfake.com',
  'email-fake.com',
  'crazymailing.com',
  'luxusmail.org',
  'fexpost.com',
  'anonbox.net',
  'anonymbox.com',
  'harakirimail.com',
  'incognitomail.org',
  'owlymail.com',
  'minuteinbox.com',
  'tempsky.com',
  'temporary-mail.net',
  'tempomail.fr',
  'instant-mail.de',
  'linshiyouxiang.net',
  'zetmail.com',
  'vomoto.com',
  'bccto.me',
  'smailpro.com',
  'internxt.com',
  'emailtemporanea.net',
  'fakemail.fr',
  'gmailnator.com',
  'etempmail.com',
  'tempm.com',
  'tmpeml.com',
  'cuvox.de',
  'dayrep.com',
  'einrot.com',
  'fleckens.hu',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
  'armyspy.com',
  'sute.jp',
  'byom.de',
  'ephemail.net',
  'mail7.io',
  'mailbox.in.ua',
  'mvrht.com',
  'spamherelots.com',
  'trbvm.com',
  'ymail.cc',
  'zzrgg.com',
]);

/** Words that mark a domain as a throwaway service even when it is not in the list yet. */
const DISPOSABLE_HINTS =
  /(^|[.-])(temp|tmp|trash|throwaway|disposable|burner|fakeinbox|guerrilla|yopmail)(mail|email|inbox)?([.-]|$)|10minute|minutemail|mailinator/;

export type EmailPolicyVerdict =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'free' | 'disposable' | 'blocked' | 'no_mail_server' };

export const EMAIL_POLICY_MESSAGES = {
  invalid: 'Enter a valid email address.',
  free: 'Use your work email address. Personal addresses such as Gmail or Outlook are not accepted.',
  disposable: 'Temporary or disposable email addresses are not accepted. Use your work email.',
  blocked: 'Email addresses from this domain are not accepted. Use your work email.',
  no_mail_server: 'This email domain cannot receive mail. Check the address.',
} as const;

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const d = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  return d.includes('.') ? d : null;
}

/** `a.b.example.com` -> `a.b.example.com`, `b.example.com`, `example.com`. */
function domainAndParents(domain: string): string[] {
  const parts = domain.split('.');
  const out: string[] = [];
  for (let i = 0; i <= parts.length - 2; i++) out.push(parts.slice(i).join('.'));
  return out;
}

/** The synchronous rules (no network). */
export function checkEmailDomain(
  email: string,
  policy: Pick<
    RegistrationSettings,
    'businessEmailOnly' | 'blockDisposableEmail' | 'blockedEmailDomains'
  >,
): EmailPolicyVerdict {
  const domain = emailDomain(email);
  if (!domain) return { ok: false, reason: 'invalid' };
  const chain = domainAndParents(domain);
  const extra = new Set(policy.blockedEmailDomains.map((d) => d.trim().toLowerCase()));
  if (chain.some((d) => extra.has(d))) return { ok: false, reason: 'blocked' };
  if (policy.blockDisposableEmail) {
    if (chain.some((d) => DISPOSABLE_EMAIL_DOMAINS.has(d)) || DISPOSABLE_HINTS.test(domain)) {
      return { ok: false, reason: 'disposable' };
    }
  }
  if (policy.businessEmailOnly && chain.some((d) => FREE_EMAIL_DOMAINS.has(d))) {
    return { ok: false, reason: 'free' };
  }
  return { ok: true };
}

const MX_TIMEOUT_MS = 2500;
const NO_MAIL_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/**
 * True when the domain definitely cannot receive mail (no MX and no A/AAAA). A timeout or a
 * resolver failure is "unknown" and lets the person through: DNS trouble must not close sign-up.
 */
export async function domainHasNoMailServer(domain: string): Promise<boolean> {
  const withTimeout = <T>(p: Promise<T>) =>
    Promise.race([
      p,
      new Promise<never>((_, rej) =>
        setTimeout(
          () => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })),
          MX_TIMEOUT_MS,
        ),
      ),
    ]);
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    if (mx.length > 0 && !mx.every((r) => r.exchange === '' || r.exchange === '.')) return false;
    return true; // null MX (RFC 7505) or empty answer
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (!NO_MAIL_CODES.has(code)) return false;
    try {
      const a = await withTimeout(dns.resolve4(domain));
      return a.length === 0;
    } catch (e2) {
      return NO_MAIL_CODES.has((e2 as { code?: string }).code ?? '');
    }
  }
}
