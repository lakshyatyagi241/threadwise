import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_TYPES,
  MARKET_APP_KINDS,
  MARKET_APP_SORTS,
  MARKET_CONNECTION_STATUSES,
  MARKET_DATA_CHOICES,
  MARKET_EVENT_STATUSES,
  MARKET_HEALTH_STATES,
  MARKET_INSTALL_STATUSES,
  MARKET_PRICING_MODELS,
  MARKET_REQUEST_STATUSES,
  MARKET_SCOPE_RISKS,
} from '@crm/contracts';
import { MKT_ERROR_EXTRA_KEYS, MKT_ERROR_KINDS } from './lib/errors';
import {
  CTA_KINDS,
  HEALTH_CHIP_KEYS,
  LOCK_REASONS,
  STATUS_CHIP_KEYS,
  lockView,
  NEEDS_CONSENT_CHIP,
} from './lib/install-state';
import { nav } from './nav';

/**
 * next-intl prints the key path when a message is missing, so every key a component asks for must exist, in English and in
 * Arabic, with the same placeholders. The keys the code builds by name are listed here from the code's own enums.
 */
type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const ROOT = 'marketplace';
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
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

const has = (k: string) => {
  expect(en[`${ROOT}.${k}`], `en ${k}`).toBeTypeOf('string');
  expect(ar[`${ROOT}.${k}`], `ar ${k}`).toBeTypeOf('string');
};

describe('marketplace messages', () => {
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

  it('keeps every key under the domain root, and none under the console slice that is another file', () => {
    for (const k of Object.keys(en)) {
      expect(k.startsWith(`${ROOT}.`), k).toBe(true);
      expect(k.startsWith(`${ROOT}.operator.`), k).toBe(false);
    }
  });

  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('Arabic keeps the same placeholders as English', () => {
    for (const k of Object.keys(en)) expect(placeholders(ar[k]!), k).toEqual(placeholders(en[k]!));
  });

  it('Arabic is Arabic: every message carries Arabic letters', () => {
    for (const [k, v] of Object.entries(ar)) expect(/[؀-ۿ]/.test(v), k).toBe(true);
  });

  it('never writes a literal placeholder brace pair or an angle bracket that ICU would read as an argument or a tag', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v, k).not.toMatch(/\{\{/);
      expect(v, k).not.toMatch(/[<>]/);
    }
    for (const [k, v] of Object.entries(ar)) {
      expect(v, k).not.toMatch(/\{\{/);
      expect(v, k).not.toMatch(/[<>]/);
    }
  });

  it('has the menu label the shell reads', () => {
    has('nav.marketplace');
    for (const item of nav) {
      expect(en[item.labelKey], item.labelKey).toBeTypeOf('string');
      expect(ar[item.labelKey], item.labelKey).toBeTypeOf('string');
    }
  });

  it('describes every value of every contract enum the screens show by name', () => {
    const wanted: string[] = [
      // kinds (tabs, badges, filters, request form)
      ...MARKET_APP_KINDS.flatMap((k) => [
        `header.tabs.${k}`,
        `detail.kind.${k}`,
        `installed.kind.${k}`,
        `requests.form.kinds.${k}`,
        `requests.list.kinds.${k}`,
        `requestBox.title.${k}`,
        `requestBox.action.${k}`,
        `browse.searchPlaceholder.${k}`,
      ]),
      // statuses and health
      ...MARKET_INSTALL_STATUSES.map((s) => `installed.status.${s}`),
      ...STATUS_CHIP_KEYS.map((s) => `chips.${s}`),
      ...HEALTH_CHIP_KEYS.map((s) => `chips.${s}`),
      ...MARKET_HEALTH_STATES.map((s) => `chips.${s}`),
      `chips.${NEEDS_CONSENT_CHIP.key}`,
      ...MARKET_REQUEST_STATUSES.map((s) => `requests.list.statuses.${s}`),
      // scopes
      ...MARKET_SCOPE_RISKS.flatMap((r) => [
        `scopes.risk.${r}`,
        `scopes.overall.${r}.title`,
        `scopes.overall.${r}.message`,
      ]),
      // pricing, connectors, connection and event states
      ...MARKET_PRICING_MODELS.map((m) => `card.pricing.${m}`),
      ...CONNECTOR_TYPES.flatMap((c) => [
        `detail.setup.intro.${c}`,
        `detail.facts.connectors.${c}`,
        `manage.connection.types.${c}`,
      ]),
      ...MARKET_CONNECTION_STATUSES.map((s) => `manage.connection.statuses.${s}`),
      ...MARKET_EVENT_STATUSES.map((s) => `manage.events.status.${s}`),
      ...MARKET_DATA_CHOICES.flatMap((c) => [
        `manage.uninstall.choices.${c}.label`,
        `manage.uninstall.choices.${c}.help`,
      ]),
      // sorts and card buttons
      ...MARKET_APP_SORTS.map((s) => `browse.sort.${s}`),
      ...['votes', 'new'].map((s) => `requests.list.sorts.${s}`),
      ...CTA_KINDS.map((c) => `card.cta.${c}`),
      // locks: one message pair per reason
      ...LOCK_REASONS.flatMap((reason) => {
        const lock = lockView({ reason, key: null, upgradeUrl: null })!;
        return [`lock.${lock.key}.chip`, `lock.${lock.key}.message`];
      }),
      // the setup form
      ...['secret', 'text', 'select'].map((k) => `detail.setup.kind.${k}`),
      ...['required', 'pattern', 'option', 'server'].map((p) => `setup.problems.${p}`),
      ...['notSet', 'endsIn', 'value', 'set'].map((p) => `setup.stored.${p}`),
      // the request form's own problems and outcomes
      ...['nameShort', 'nameLong', 'websiteInvalid', 'noteLong', 'server'].map(
        (p) => `requests.form.problems.${p}`,
      ),
      ...['created', 'counted'].flatMap((o) => [
        `requests.form.result.${o}.title`,
        `requests.form.result.${o}.message`,
      ]),
      // install steps
      ...['permissions', 'setup', 'done'].map((s) => `install.steps.${s}`),
      // page titles
      ...['apps', 'integrations', 'app', 'install', 'installed', 'manage', 'requests'].map(
        (p) => `meta.${p}`,
      ),
      // every error kind and its numeric variants
      ...MKT_ERROR_KINDS.map((k) => `errors.${k}`),
      ...MKT_ERROR_EXTRA_KEYS.map((k) => `errors.${k}`),
    ];
    for (const k of wanted) has(k);
  });

  it('every literal t("...") key a component or a page asks for exists in both languages', () => {
    const missing: string[] = [];
    const files = [
      ...sources(join(__dirname, 'components')),
      ...sources(resolve(WEB, 'src/app/(app)/(marketplace)')),
    ];
    // The route pages are .tsx too and ask for `meta` titles with `await getTranslations`.
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // A name can be bound more than once in a file (one `t` per component), so a key counts when ANY binding of the name has it.
      const bindings = new Map<string, string[]>();
      for (const m of src.matchAll(
        /const (\w+) = (?:await )?(?:useTranslations|getTranslations)\('([^']+)'\)/g,
      )) {
        bindings.set(m[1]!, [...(bindings.get(m[1]!) ?? []), m[2]!]);
      }
      for (const [name, bases] of bindings) {
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) {
          const ok = bases.some(
            (b) => en[`${b}.${m[1]}`] !== undefined && ar[`${b}.${m[1]}`] !== undefined,
          );
          if (!ok)
            missing.push(`${file.split('src')[1]}: ${name}('${m[1]}') in ${bases.join(' | ')}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every template key a component builds by name has its prefix in the messages', () => {
    // `t(`pricing.${x}`)` and friends are checked value by value above; this proves the namespaces they hang off exist.
    const missing: string[] = [];
    for (const file of sources(join(__dirname, 'components'))) {
      const src = readFileSync(file, 'utf8');
      const bindings = new Map<string, string[]>();
      for (const m of src.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)) {
        bindings.set(m[1]!, [...(bindings.get(m[1]!) ?? []), m[2]!]);
      }
      for (const [name, bases] of bindings) {
        const template = new RegExp(`\\b${name}\\(\\s*\`([\\w.]+)\\.\\$\\{`, 'g');
        for (const m of src.matchAll(template)) {
          const ok = bases.some((b) => Object.keys(en).some((k) => k.startsWith(`${b}.${m[1]}.`)));
          if (!ok)
            missing.push(
              `${file.split('src')[1]}: ${name}(\`${m[1]}.\${...}\`) in ${bases.join(' | ')}`,
            );
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
