import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DANGER_ACTIONS } from './lib/danger';
import { EVENT_STATUSES } from './lib/events';
import { FIELD_TAB, SECURITY_TABS } from './lib/policy-draft';
import { SHOWCASE_GROUPS } from './lib/auth-pages-draft';
import { OTP_ACTIVATION_REASONS, OTP_SENDER_KINDS } from '@crm/contracts';
import { KIND_FIELDS } from './lib/otp-senders';
import { sectionEditors } from './operator-role';

type Tree = { [key: string]: string | Tree };

const FILE = 'auth-registration-security.platform.json';
const load = (locale: string): Tree => {
  const root = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, FILE), 'utf8'),
  ) as Tree;
  return ((root['auth-registration-security'] as Tree)['platform'] as Tree) ?? {};
};

function flatten(tree: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : flatten(value, `${prefix}${key}.`),
  );
}

/** `{count}`, `{phrase}` ... and rich-text tags: what a translation must keep. */
const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)(?:,|\})/g)]
    .map((m) => m[1]!)
    .concat([...text.matchAll(/<(\w+)>/g)].map((m) => `<${m[1]}>`))
    .sort();

describe('platform messages', () => {
  const en = flatten(load('en'));
  const ar = flatten(load('ar'));

  it('never uses a dot inside a key (next-intl reads it as nesting)', () => {
    const roots = [load('en'), load('ar')];
    const dotted: string[] = [];
    const walk = (t: Tree, path: string) => {
      for (const [k, v] of Object.entries(t)) {
        if (k.includes('.')) dotted.push(`${path}${k}`);
        if (typeof v !== 'string') walk(v, `${path}${k}/`);
      }
    };
    roots.forEach((r) => walk(r, ''));
    expect(dotted).toEqual([]);
  });

  it('has the same keys in English and Arabic', () => {
    const enKeys = new Set(en.map(([k]) => k));
    const arKeys = new Set(ar.map(([k]) => k));
    expect([...enKeys].filter((k) => !arKeys.has(k))).toEqual([]);
    expect([...arKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('keeps the same placeholders and tags in every translation', () => {
    const arMap = new Map(ar);
    const mismatched = en.filter(([k, v]) => {
      const t = arMap.get(k);
      return t !== undefined && placeholders(t).join() !== placeholders(v).join();
    });
    expect(mismatched.map(([k]) => k)).toEqual([]);
  });

  it('has no empty strings', () => {
    expect([...en, ...ar].filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([]);
  });

  it('covers every key built at run time (controls, tabs, danger actions, event statuses, showcase fields)', () => {
    const keys = new Set(en.map(([k]) => k));
    const expected: string[] = [];
    for (const control of Object.keys(FIELD_TAB))
      expected.push(`security.controls.${control}.label`);
    for (const tab of SECURITY_TABS) expected.push(`security.tabs.${tab}`);
    for (const kind of Object.keys(DANGER_ACTIONS)) {
      for (const part of ['title', 'body', 'effect1', 'effect2', 'confirm', 'done']) {
        expected.push(`security.danger.dialog.${kind}.${part}`);
      }
    }
    for (const target of ['google', 'facebook', 'recaptcha'])
      expected.push(`social.removeSecret.names.${target}`);
    for (const section of ['policy', 'registration', 'social', 'authPages', 'plans'] as const) {
      expected.push(`common.readOnly.${sectionEditors(section)}`);
    }
    for (const status of EVENT_STATUSES) expected.push(`events.status.${status}`);
    for (const key of Object.values(SHOWCASE_GROUPS).flat())
      expected.push(`authPages.showcase.keys.${key}`);
    for (const p of ['login', 'register', 'forgot']) {
      expected.push(`authPages.pages.${p}`, `authPages.preview.form.submit.${p}`);
    }
    expect(expected.filter((k) => !keys.has(k))).toEqual([]);
  });

  it('covers every sign-up code message built at run time (verdicts, senders, template, test send)', () => {
    const keys = new Set(en.map(([k]) => k));
    const reg = 'registration';
    const expected: string[] = [];
    for (const reason of OTP_ACTIVATION_REASONS)
      expected.push(`${reg}.otp.status.reason.${reason}`);
    for (const kind of OTP_SENDER_KINDS) {
      expected.push(
        `${reg}.otp.sender.kinds.${kind}`,
        `${reg}.senders.kinds.${kind}`,
        `${reg}.senders.kindHint.${kind}`,
        `${reg}.senders.secretLabel.${kind}`,
      );
      for (const field of KIND_FIELDS[kind]) {
        if (field === 'secret') continue;
        expected.push(`${reg}.senders.fields.${field}`);
      }
    }
    for (const state of ['none', 'pending', 'approved', 'rejected', 'local'])
      expected.push(`${reg}.otp.template.states.${state}`);
    for (const kind of ['none', 'waba', 'local'])
      expected.push(`${reg}.otp.template.explain.${kind}`);
    for (const outcome of [
      'submitted',
      'resubmitted',
      'local_ready',
      'already_pending',
      'already_approved',
      'refreshed',
    ])
      expected.push(`${reg}.otp.template.outcome.${outcome}`);
    for (const status of ['pending', 'approved', 'rejected', 'local'])
      expected.push(`${reg}.otp.template.refreshed.${status}`);
    for (const what of ['submit', 'check', 'rejected', 'unexpected'])
      expected.push(`${reg}.otp.template.errors.${what}`);
    for (const reason of [
      'not_configured',
      'template_not_approved',
      'invalid_number',
      'auth_failed',
      'rejected',
      'provider_error',
      'connection_refused',
      'timeout',
      'transport_error',
    ])
      expected.push(`${reg}.otp.test.reasons.${reason}`);
    for (const code of ['required', 'tooLong', 'digits', 'url', 'accountSid', 'phone'])
      expected.push(`${reg}.senders.problems.${code}`);
    for (const code of [
      'range',
      'tooLong',
      'required',
      'link',
      'senderFormat',
      'senderRequired',
      'countryFormat',
    ])
      expected.push(`${reg}.problems.${code}`);
    expect(expected.filter((k) => !keys.has(k))).toEqual([]);
  });
});
