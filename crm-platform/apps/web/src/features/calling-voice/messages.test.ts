import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CALL_ERROR_CODES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  CALL_ERROR_KEYS,
  CALL_FAILURE_KINDS,
  CALL_FAILURE_TEXT,
  END_REASON_TEXT,
} from './lib/calls';

/**
 * The domain's strings live in messages/en/calling-voice.json (the other languages fall back to English until translated).
 * These checks make sure no component asks for a key that is missing (next-intl would print the key path instead of text),
 * that every error code and failure kind has words, and that the default texts in code and in the messages agree.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT_KEY = 'calling-voice';

type Tree = { [key: string]: string | Tree };
const tree = JSON.parse(
  readFileSync(join(WEB, 'messages', 'en', 'calling-voice.json'), 'utf8'),
) as Tree;

function flatten(t: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const en = flatten(tree);
const at = (path: string) => en[`${ROOT_KEY}.${path}`];

describe('calling-voice messages', () => {
  it('keeps every key under the domain root and non-empty', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(key.startsWith(`${ROOT_KEY}.`), key).toBe(true);
      expect(text.trim(), key).not.toBe('');
    }
  });

  it('has words for every error code, failure kind and end reason', () => {
    for (const k of CALL_ERROR_KEYS) expect(at(`errors.${k}`), `errors.${k}`).toBeTypeOf('string');
    for (const code of Object.values(CALL_ERROR_CODES))
      expect(at(`errors.${code}`), `errors.${code}`).toBeTypeOf('string');
    for (const k of CALL_FAILURE_KINDS)
      expect(at(`failures.${k}`), `failures.${k}`).toBeTypeOf('string');
  });

  it('says in the messages exactly what the peer says by default (Reference wording)', () => {
    for (const k of CALL_FAILURE_KINDS) expect(at(`failures.${k}`), k).toBe(CALL_FAILURE_TEXT[k]);
    for (const [reason, text] of Object.entries(END_REASON_TEXT))
      expect(at(`failures.${reason}`)).toBe(text);
  });

  it('keeps the Reference toast texts', () => {
    expect(at('toast.noPhone')).toBe('No phone number on this contact.');
    expect(at('toast.noNumber')).toBe('Calling is not enabled on any WABA number.');
    expect(at('toast.alreadyPermitted')).toBe(
      'This contact already allows calls - starting the call...',
    );
    expect(at('toast.permissionSent')).toBe(
      'Permission request sent. They will see Accept/Decline in WhatsApp - try Call again after they respond.',
    );
    expect(at('toast.permissionFailed')).toBe('Could not send permission request: {message}');
    expect(at('toast.startFailed')).toBe('Could not start call: {message}');
    expect(at('toast.acceptInvalid')).toBe(
      'Could not accept call: invalid call payload from WhatsApp. Try again.',
    );
    expect(at('toast.acceptFailed')).toBe('Could not accept call: {message}');
    expect(at('toast.alreadyAccepted')).toBe('Call already accepted by another teammate.');
    expect(at('toast.recordingSaved')).toBe('Call recording saved to Call logs.');
    expect(at('toast.recordUnsupported')).toBe('Recording is not supported in this browser.');
    expect(at('incoming.aiHandling')).toBe('AI is handling this call...');
    expect(at('panel.ringing')).toBe('ringing...');
    expect(at('settings.disable')).toBe('Turn off calling');
    expect(at('settings.enable')).toBe('Enable calling');
    expect(at('errors.PLAN_FEATURE_LOCKED')).toBe('Your plan does not include WhatsApp calling.');
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')` paired with the namespace of the nearest preceding `useTranslations('ns')`. */
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

describe('message keys used in code', () => {
  const files = [
    ...sourceFiles(join(WEB, 'src', 'features', 'calling-voice')),
    ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(calling-voice)')),
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
    expect(checked).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it('are all used (no dead strings)', () => {
    // The nav label is read by the menu from `nav.ts`, not by a component.
    const used = new Set(files.flatMap((f) => usedKeys(readFileSync(f, 'utf8'))));
    // Keys built at run time: failures.*, errors.* (see use-error-text.ts).
    const dynamic = /^calling-voice\.(failures\.|errors\.|nav\.)/;
    const dead = Object.keys(en).filter((k) => !used.has(k) && !dynamic.test(k));
    expect(dead).toEqual([]);
  });
});
