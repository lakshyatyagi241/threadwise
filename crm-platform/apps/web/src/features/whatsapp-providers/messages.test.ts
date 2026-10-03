import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HEADER_PLACEHOLDERS,
  SWITCH_NUMBER_STATES,
  WHATSAPP_AUTH_SCHEMES,
  WHATSAPP_BILLING_MODES,
  WHATSAPP_CREDENTIAL_MODES,
  WHATSAPP_ONBOARDING_METHODS,
  WHATSAPP_PROVIDER_STATUSES,
  WHATSAPP_SIGNATURE_SCHEMES,
  WHATSAPP_WEBHOOK_MODES,
  assignmentSourceSchema,
} from '@crm/contracts';
import { OPERATOR_NAV } from '../auth-registration-security/platform/operator-nav';
import { WAP_ERROR_KEYS } from './lib/errors';
import { WIZARD_STEPS } from './lib/draft';
import { REQUIREMENT_KEYS } from './lib/switch-plan';
import { STATUS_FILTERS } from './lib/provider-view';
import { WAP_OPERATOR_NAV } from './operator-nav';

/**
 * next-intl prints the key path when a message is missing, so every key a component asks for must exist, in English and in
 * Arabic, with the same placeholders. The keys the code builds by name are listed here from the code's own enums.
 */
type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const ROOT = 'whatsapp-providers';
const load = (locale: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, `${ROOT}.json`), 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const en = flatten(load('en'));
const ar = flatten(load('ar'));

/** `{name}` and `{count, plural, ...}` placeholders, by variable name. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('whatsapp providers messages', () => {
  it('every message is non-empty and no key holds a dot (next-intl reads it as nesting)', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe('');
    for (const [k, v] of Object.entries(ar)) expect(v.trim(), k).not.toBe('');
    const dotted: string[] = [];
    const walk = (t: Tree) => {
      for (const [k, v] of Object.entries(t)) {
        if (k.includes('.')) dotted.push(k);
        if (typeof v !== 'string') walk(v);
      }
    };
    walk(load('en'));
    walk(load('ar'));
    expect(dotted).toEqual([]);
  });

  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('Arabic keeps the same placeholders as English', () => {
    for (const k of Object.keys(en)) expect(placeholders(ar[k]!), k).toEqual(placeholders(en[k]!));
  });

  it('never writes a literal placeholder brace pair that ICU would read as an argument', () => {
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toMatch(/\{\{/);
    for (const [k, v] of Object.entries(ar)) expect(v, k).not.toMatch(/\{\{/);
  });

  it('labels every console menu entry and its group', () => {
    for (const item of WAP_OPERATOR_NAV) {
      expect(en[item.labelKey], item.labelKey).toBeTypeOf('string');
      expect(en[item.groupKey], item.groupKey).toBeTypeOf('string');
      expect(
        OPERATOR_NAV.some((n) => n.id === item.id && n.href === item.href),
        item.id,
      ).toBe(true);
    }
  });

  it('describes every value of every contract enum the screens show by name', () => {
    const wanted: string[] = [
      ...WHATSAPP_AUTH_SCHEMES.map((v) => `authScheme.${v}`),
      ...WHATSAPP_CREDENTIAL_MODES.map((v) => `credentialMode.${v}`),
      ...WHATSAPP_WEBHOOK_MODES.map((v) => `webhookMode.${v}`),
      ...WHATSAPP_SIGNATURE_SCHEMES.map((v) => `signatureScheme.${v}`),
      ...WHATSAPP_BILLING_MODES.map((v) => `billingMode.${v}`),
      ...WHATSAPP_ONBOARDING_METHODS.map((v) => `onboarding.${v}`),
    ].flatMap((p) => [`${ROOT}.enums.${p}.label`, `${ROOT}.enums.${p}.help`]);
    wanted.push(
      ...WHATSAPP_PROVIDER_STATUSES.map((s) => `${ROOT}.status.${s}`),
      `${ROOT}.status.default`,
      `${ROOT}.status.builtin`,
      ...STATUS_FILTERS.map((s) => `${ROOT}.list.filters.${s}`),
      ...assignmentSourceSchema.options.map((s) => `${ROOT}.assignments.source.${s}`),
      ...SWITCH_NUMBER_STATES.map((s) => `${ROOT}.switch.numbers.state.${s}`),
      ...Object.values(REQUIREMENT_KEYS).flatMap((r) => [
        `${ROOT}.switch.requirements.${r}.label`,
        `${ROOT}.switch.requirements.${r}.help`,
      ]),
      ...HEADER_PLACEHOLDERS.map((p) => `${ROOT}.headers.placeholders.${p}`),
      ...WIZARD_STEPS.flatMap((s) => [`${ROOT}.form.steps.${s}`, `${ROOT}.form.stepHelp.${s}`]),
      ...WAP_ERROR_KEYS.map((k) => `${ROOT}.errors.${k}`),
    );
    for (const k of wanted) {
      expect(en[k], `en ${k}`).toBeTypeOf('string');
      expect(ar[k], `ar ${k}`).toBeTypeOf('string');
    }
  });

  it('has the keys the code builds from its own result codes', () => {
    const wanted = [
      // lib/header-templates HeaderProblemCode
      ...[
        'tooMany',
        'nameInvalid',
        'nameDenied',
        'nameDuplicate',
        'valueEmpty',
        'valueTooLong',
        'valueCharacters',
        'placeholderUnknown',
        'strayBrace',
        'credentialNotCarried',
      ].map((c) => `headers.problems.${c}`),
      // lib/draft problems and base-url codes
      ...[
        'labelRequired',
        'labelLength',
        'notesLength',
        'keyRequired',
        'keyBuiltin',
        'keyFormat',
        'apiVersion',
        'headers',
        'signatureHeaderRequired',
        'signatureHeaderFormat',
        'digits',
        'secretCharacters',
        'secretLength',
      ].map((c) => `form.problems.${c}`),
      ...[
        'empty',
        'length',
        'characters',
        'invalid',
        'credentials',
        'queryOrFragment',
        'notHttps',
        'port',
        'host',
        'internal',
      ].map((c) => `form.problems.baseUrl.${c}`),
      // lib/draft secret status and gaps
      ...['willClear', 'willReplace', 'setWithHint', 'set', 'notSet'].map((c) => `secret.${c}`),
      ...['providerToken', 'appSecret', 'webhookSecret'].map((c) => `gaps.${c}`),
      ...['providerToken', 'appSecret', 'webhookSecret', 'verifyToken'].map(
        (c) => `form.fields.${c}`,
      ),
      // lib/test-result TestHint
      ...[
        'ok',
        'addressRefused',
        'credentialsMissing',
        'unauthorized',
        'notFound',
        'rateLimited',
        'providerError',
        'unreachable',
        'other',
      ].map((c) => `test.hints.${c}`),
      // components/provider-actions
      ...['default', 'builtin', 'inUse'].map((c) => `actions.blocked.${c}`),
      ...['activate', 'disable', 'archive', 'default', 'clearDefault'].map(
        (c) => `actions.done.${c}`,
      ),
      ...['disable', 'archive', 'default', 'clearDefault'].flatMap((c) => [
        `actions.confirm.${c}.title`,
        `actions.confirm.${c}.body`,
        `actions.confirm.${c}.action`,
      ]),
      'actions.confirm.disable.inUse',
      // fields the review step reads by name
      ...[
        'key',
        'label',
        'baseUrl',
        'apiVersion',
        'authScheme',
        'credentialMode',
        'webhookMode',
        'signatureScheme',
        'billingMode',
        'mediaUpload',
        'onboarding',
      ].map((c) => `form.fields.${c}`),
    ].map((k) => `${ROOT}.${k}`);
    for (const k of wanted) {
      expect(en[k], `en ${k}`).toBeTypeOf('string');
      expect(ar[k], `ar ${k}`).toBeTypeOf('string');
    }
  });

  it('every literal t("...") key a component asks for exists in both languages', () => {
    const missing: string[] = [];
    for (const file of sources(join(__dirname, 'components'))) {
      const src = readFileSync(file, 'utf8');
      const ns = /const NS = '([^']+)'/.exec(src)?.[1] ?? '';
      // A name can be bound more than once in a file (one `t` per component), so a key counts when ANY binding of the name has it.
      const bindings = new Map<string, string[]>();
      for (const m of src.matchAll(/const (\w+) = useTranslations\(([^)]*)\)/g)) {
        const arg = m[2]!.trim();
        const lit = /^'([^']+)'$/.exec(arg)?.[1];
        const tpl = /^`\$\{NS\}(?:\.([\w.]+))?`$/.exec(arg);
        const base = lit ?? (arg === 'NS' ? ns : tpl ? (tpl[1] ? `${ns}.${tpl[1]}` : ns) : null);
        if (base) bindings.set(m[1]!, [...(bindings.get(m[1]!) ?? []), base]);
      }
      for (const [name, bases] of bindings) {
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) {
          const ok = bases.some(
            (b) => en[`${b}.${m[1]}`] !== undefined && ar[`${b}.${m[1]}`] !== undefined,
          );
          if (!ok)
            missing.push(
              `${file.split('features')[1]}: ${name}('${m[1]}') in ${bases.join(' | ')}`,
            );
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
