import { createHmac } from 'node:crypto';
import { Rng, json, mutate, setOwn, text } from '../gen';
import { Violation, type Target } from '../engine';
import {
  signTelephonyCallback,
  verifyTelephonyCallback,
} from '../../../src/infra/providers/telephony/telephony-signature';
import {
  twilioSignature,
  verifyTwilioSignature,
} from '../../../src/infra/providers/channel-sms/twilio-signature';
import {
  sign as signOutbound,
  verify as verifyOutbound,
} from '../../../src/modules/outbound-webhooks/signing';
import {
  verifyRazorpaySignature,
  signRazorpayBody,
} from '../../../src/infra/providers/storefront-builder/razorpay-payloads';
import { verifyOAuthHmac } from '../../../src/modules/shopify-woocommerce/ecom-rules';
import { verifyHandshake } from '../../../src/modules/channel-facebook/page-rules';
import {
  verifyUnsubscribeToken,
  signUnsubscribeToken,
} from '../../../src/modules/contact-consent/consent-unsubscribe.tokens';
import { signState, verifyState, newState } from '../../../src/modules/channel-email/mail-state';
import { verifyTotp } from '../../../src/modules/auth/support/totp';

/**
 * Webhook signature and signed-token verifiers. A verifier fed anything must answer yes or no and never throw (an unauthenticated
 * route that throws answers 500 instead of 401), must say no to a forgery (a valid signature with one character or one byte changed,
 * or a header that is not a signature), and must say yes to the genuine one.
 */

/** The same text with one character changed. */
function tamper(r: Rng, s: string): string {
  if (s.length === 0) return 'x';
  const at = r.int(s.length);
  const c = s[at]!;
  return s.slice(0, at) + (c === 'A' ? 'B' : 'A') + s.slice(at + 1);
}

const secretOf = (r: Rng) =>
  r.pick(['k', 'secret-0123456789', text(r).slice(0, 40) || 'z', 'a'.repeat(100)]);

export function signatureTargets(): Target[] {
  const t: Target[] = [];

  t.push({
    name: 'sig:telephony-callback',
    group: 'signatures',
    weight: 20,
    gen: (r) => {
      const secret = secretOf(r);
      const body = Buffer.from(text(r).slice(0, 2000), 'utf8');
      const now = new Date(1_800_000_000_000);
      const ts = String(
        Math.floor(now.getTime() / 1000) + r.pick([0, 0, 1, -299, 299, 301, -301, 100000, -100000]),
      );
      const good = signTelephonyCallback(secret, ts, body);
      const k = r.int(5);
      const header =
        k === 0
          ? good
          : k === 1
            ? tamper(r, good)
            : k === 2
              ? text(r)
              : k === 3
                ? ` ${good} `
                : `v1=${mutate(r, good.slice(3))}`;
      return { secret, ts: r.chance(0.8) ? ts : text(r), header, body, now, good };
    },
    run: (v) => {
      const { secret, ts, header, body, now, good } = v as {
        secret: string;
        ts: string;
        header: string;
        body: Buffer;
        now: Date;
        good: string;
      };
      const ok = verifyTelephonyCallback(secret, ts, header, body, now);
      const genuine =
        header.trim() === good &&
        ts.trim() === ts &&
        /^\d{9,12}$/.test(ts) &&
        Math.abs(now.getTime() / 1000 - Number(ts)) <= 300 &&
        secret !== '';
      if (ok && header.trim() !== signTelephonyCallback(secret, ts.trim(), body))
        throw new Violation('a forged telephony callback verified');
      if (genuine && header === good && !ok)
        throw new Violation('a genuine telephony callback was refused');
      verifyTelephonyCallback(secret, undefined, header, body, now);
      verifyTelephonyCallback(secret, ts, undefined, body, now);
    },
  });

  t.push({
    name: 'sig:twilio-request',
    group: 'signatures',
    weight: 25,
    gen: (r) => {
      // The parameters of a form post: strings, repeated fields as arrays, and what a nested query-string parser makes of `a[b]=c`.
      const params: Record<string, unknown> = {};
      for (let i = r.range(0, 6); i > 0; i -= 1) {
        const k = r.chance(0.2)
          ? r.pick(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
          : text(r).slice(0, 30);
        const x = r.next();
        setOwn(
          params,
          k,
          x < 0.6
            ? text(r).slice(0, 60)
            : x < 0.75
              ? [text(r), text(r)]
              : x < 0.9
                ? json(r)
                : { toString: text(r).slice(0, 5) },
        );
      }
      const plain = Object.values(params).every((x) => typeof x === 'string');
      return {
        token: secretOf(r),
        url: `https://api.example.com/hook/${text(r).slice(0, 10)}`,
        params,
        header: r.pick([undefined, '', text(r), 'x'.repeat(28)]),
        plain,
      };
    },
    run: (v) => {
      const { token, url, params, header, plain } = v as {
        token: string;
        url: string;
        params: Record<string, unknown>;
        header: string | undefined;
        plain: boolean;
      };
      if (verifyTwilioSignature(token, url, params, header))
        throw new Violation('a forged Twilio request verified');
      if (plain) {
        const good = twilioSignature(token, url, params);
        if (!verifyTwilioSignature(token, url, params, good))
          throw new Violation('a genuine Twilio request was refused');
        if (verifyTwilioSignature(token, url, params, tamper(Rng.for(1, 'tw', good.length), good)))
          throw new Violation('a tampered Twilio signature verified');
      }
    },
  });

  t.push({
    name: 'sig:outbound-webhook',
    group: 'signatures',
    weight: 10,
    gen: (r) => {
      const secret = secretOf(r);
      const ts = text(r).slice(0, 12);
      const body = text(r).slice(0, 500);
      const good = signOutbound(secret, ts, body);
      return {
        secret,
        ts,
        body,
        header: r.pick([good, tamper(r, good), text(r), '', good + 'x']),
        good,
      };
    },
    run: (v) => {
      const { secret, ts, body, header, good } = v as {
        secret: string;
        ts: string;
        body: string;
        header: string;
        good: string;
      };
      const ok = verifyOutbound(secret, ts, body, header);
      if (ok !== (header === good))
        throw new Violation(
          `verify returned ${ok} for ${header === good ? 'the genuine' : 'a forged'} signature`,
        );
    },
  });

  t.push({
    name: 'sig:razorpay-body',
    group: 'signatures',
    weight: 10,
    gen: (r) => {
      const secret = secretOf(r);
      const body = text(r).slice(0, 500);
      const good = signRazorpayBody(body, secret);
      return {
        secret,
        body,
        header: r.pick([
          good,
          good.toUpperCase(),
          ` ${good} `,
          tamper(r, good),
          text(r),
          undefined,
          '',
        ]),
        good,
      };
    },
    run: (v) => {
      const { secret, body, header, good } = v as {
        secret: string;
        body: string;
        header: string | undefined;
        good: string;
      };
      const ok = verifyRazorpaySignature(body, header, secret);
      const genuine = header !== undefined && header.trim().toLowerCase() === good;
      if (ok !== genuine)
        throw new Violation(
          `verifyRazorpaySignature returned ${ok} where the signature is ${genuine ? 'genuine' : 'forged'}`,
        );
    },
  });

  t.push({
    name: 'sig:shopify-oauth-hmac',
    group: 'signatures',
    weight: 15,
    gen: (r) => {
      // A query string parsed by Express: values can be strings, arrays or nested objects at run time.
      const query: Record<string, unknown> = {};
      for (let i = r.range(0, 5); i > 0; i -= 1)
        setOwn(
          query,
          r.chance(0.2)
            ? r.pick(['hmac', 'signature', '__proto__', 'constructor'])
            : text(r).slice(0, 20),
          r.chance(0.7) ? text(r).slice(0, 40) : r.chance(0.5) ? [text(r)] : json(r),
        );
      return { query, secret: secretOf(r) };
    },
    run: (v) => {
      const { query, secret } = v as { query: Record<string, string>; secret: string };
      if (verifyOAuthHmac(query, secret)) throw new Violation('a forged Shopify callback verified');
    },
  });

  t.push({
    name: 'sig:handshake-and-totp',
    group: 'signatures',
    weight: 10,
    gen: (r) => [
      text(r).slice(0, 60),
      text(r).slice(0, 60),
      r.chance(0.2) ? null : text(r).slice(0, 60),
      text(r).slice(0, 12),
    ],
    run: (v) => {
      const [mode, token, expected, code] = v as [string, string, string | null, string];
      if (verifyHandshake(mode, token, expected) && !(mode === 'subscribe' && token === expected))
        throw new Violation('a handshake with the wrong token verified');
      const step = verifyTotp('JBSWY3DPEHPK3PXP', code);
      if (step !== null && !/^\d{6}$/.test(code))
        throw new Violation('a TOTP code that is not six digits verified');
    },
  });

  const key = createHmac('sha256', 'fuzz').update('key').digest();
  t.push({
    name: 'sig:signed-state-tokens',
    group: 'signatures',
    weight: 20,
    gen: (r) => {
      const state = newState(
        { orgId: r.range(1, 99), userId: 1, returnTo: '/x' },
        1_800_000_000_000,
      );
      const good = signState(state, key);
      const unsub = signUnsubscribeToken([key], 7, 9);
      const k = r.int(6);
      return {
        mail:
          k === 0
            ? good
            : k === 1
              ? tamper(r, good)
              : k === 2
                ? text(r)
                : k === 3
                  ? mutate(r, good)
                  : `${good}.${text(r)}`,
        unsub: r.pick([
          unsub,
          tamper(r, unsub),
          text(r),
          `${unsub}.x`,
          mutate(r, unsub),
          '.',
          'a.b',
        ]),
        genuineMail: k === 0,
        genuineUnsub: false,
      };
    },
    run: (v) => {
      const { mail, unsub } = v as { mail: string; unsub: string };
      const m = verifyState(mail, key, 1_800_000_000_000);
      if (typeof m.ok !== 'boolean') throw new Violation('verifyState did not answer');
      const u = verifyUnsubscribeToken([key], unsub);
      if (u !== null && (u.orgId !== 7 || u.contactId !== 9))
        throw new Violation('a forged unsubscribe token verified');
    },
  });

  return t;
}
