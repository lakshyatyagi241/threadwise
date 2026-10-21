import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CHANNEL_KINDS,
  CONVERSATION_EVENT_TYPES,
  CONVERSATION_STATUSES,
  INBOX_TABS,
  INBOX_TEMPLATE_BLOCK_REASONS,
  SAVED_REPLY_VARIABLES,
  SAVED_REPLY_VARIABLE_GROUPS,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ERROR_KINDS } from './lib/errors';
import { SEND_FAULTS } from './components/simulator-drawer';

/**
 * The domain's strings live in messages/<locale>/team-inbox-conversations.json. These checks keep English and Arabic in step and
 * make sure no component asks for a key that is missing (next-intl would print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../..');
const FILE = 'team-inbox-conversations.json';
const ROOT_KEY = 'team-inbox-conversations';

type Tree = { [key: string]: string | Tree };
const load = (locale: string): Tree =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, FILE), 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** `{name}` and `{count, plural, ...}` placeholders, by variable name. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();

/**
 * Two domain slices of their own (messages/<locale>/team-inbox-conversations.<slice>.json), merged at runtime: the "Imported" marker and
 * the handoff queue (BL-396).
 */
const loadSlice = (locale: string, slice: string): Tree =>
  JSON.parse(
    readFileSync(join(WEB, 'messages', locale, `team-inbox-conversations.${slice}.json`), 'utf8'),
  ) as Tree;
const SLICES = ['imported', 'handoff'] as const;
const withSlices = (locale: string) =>
  Object.assign(
    flatten(load(locale)),
    ...SLICES.map((slice) => flatten(loadSlice(locale, slice))),
  ) as Record<string, string>;
const en = withSlices('en');
const ar = withSlices('ar');

describe('team-inbox-conversations messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('every message is non-empty and uses the same placeholders in both languages', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('');
      expect(ar[key]?.trim(), key).not.toBe('');
      expect(placeholders(ar[key]!), `placeholders of ${key}`).toEqual(placeholders(text));
    }
  });

  it('Arabic plurals spell out the categories the language needs', () => {
    for (const [key, text] of Object.entries(ar)) {
      if (!text.includes('plural,')) continue;
      for (const cat of ['one', 'two', 'few', 'many', 'other']) {
        expect(text, `${key} lacks ${cat}`).toContain(`${cat} {`);
      }
    }
  });

  it('keeps every key under the domain root', () => {
    for (const key of Object.keys(en)) expect(key.startsWith(`${ROOT_KEY}.`), key).toBe(true);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')`, `t.rich('key')`, `t.has('key')`, paired with the namespace of the nearest preceding declaration. */
function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']+)'\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2]!, index: m.index ?? 0 }));
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.has)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const at = c.index ?? 0;
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < at);
      if (owner) out.push(`${owner.ns}.${c[1]}`);
    }
  }
  return out;
}

/** Keys built at run time from the shared enums. */
const DYNAMIC = [
  ...INBOX_TABS.flatMap((s) => [
    `list.tabs.${s}`,
    `list.empty.${s}.title`,
    `list.empty.${s}.message`,
  ]),
  ...CONVERSATION_STATUSES.flatMap((s) => [`list.status.${s}`, `panel.past.status.${s}`]),
  ...(['low', 'normal', 'high', 'urgent'] as const).map((s) => `list.priority.${s}`),
  ...(['online', 'away', 'busy', 'offline'] as const).map(
    (s) => `panel.assignee.availability.${s}`,
  ),
  ...(['first_response', 'resolution'] as const).map((s) => `sla.kind.${s}`),
  ...(['received', 'queued', 'sent', 'delivered', 'read', 'failed'] as const).map(
    (s) => `status.${s}`,
  ),
  ...ERROR_KINDS.filter((k) => k !== 'generic').map((s) => `errors.${s}`),
  ...CONVERSATION_EVENT_TYPES.map((s) => `panel.timeline.events.${s}`),
  ...(['user', 'system', 'bot', 'flow', 'ai'] as const).map((s) => `panel.timeline.actors.${s}`),
  ...(['online', 'away', 'busy', 'offline'] as const).map((s) => `panel.presence.${s}`),
  ...(['reply', 'note'] as const).map((s) => `composer.mode.${s}`),
  ...SEND_FAULTS.map((s) => `simulator.faults.${s}`),
  ...(['auto', 'open', 'closed'] as const).map((s) => `simulator.windows.${s}`),
  ...(['text', 'image', 'document', 'audio', 'video', 'location'] as const).map(
    (s) => `simulator.kinds.${s}`,
  ),
  ...(['connected', 'disconnected', 'error'] as const).map((s) => `channels.status.${s}`),
  ...(['resolved', 'closed', 'spam', 'snoozed'] as const).map((s) => `thread.status.${s}`),
  ...(['image', 'text', 'attachment'] as const).map((s) => `bubble.kind.${s}`),
  ...INBOX_TEMPLATE_BLOCK_REASONS.map((r) => `templates.reason.${r}`),
  ...(['required', 'format'] as const).map((p) => `templates.problem.${p}`),
  'panel.timeline.events.unknown',
  ...CHANNEL_KINDS.map((k) => `savedReplies.channelKind.${k}`),
  ...SAVED_REPLY_VARIABLES.map((v) => `savedReplies.variable.${v.key}`),
  ...SAVED_REPLY_VARIABLE_GROUPS.map((g) => `savedReplies.variableGroup.${g}`),
  ...(['all', 'shared', 'mine'] as const).map((k) => `savedReplies.screen.tab.${k}`),
  ...(['shared', 'mine'] as const).flatMap((k) => [
    `savedReplies.screen.scope.${k}`,
    `savedReplies.form.scopeOption.${k}`,
  ]),
];

describe('message keys used in code', () => {
  const files = [
    ...sourceFiles(join(WEB, 'src', 'features', 'team-inbox-conversations')),
    ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(team-inbox-conversations)')),
  ];

  it('exist in the English messages', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built at run time', () => {
    const missing = DYNAMIC.filter((k) => !(`${ROOT_KEY}.${k}` in en));
    expect(missing).toEqual([]);
  });

  it('are all used somewhere (no dead strings)', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(en).filter((key) => {
      if (used.has(key) || DYNAMIC.includes(key.slice(ROOT_KEY.length + 1))) return false;
      // keys built from a template or a ternary: accept when the last segment appears in the source
      const last = key.split('.').at(-1)!;
      return !new RegExp(`['"\`.]${last}['"\`.\\s)]`).test(text);
    });
    expect(unused).toEqual([]);
  });
});
