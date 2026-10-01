import { AUTH_PAGE_EXTRA_KEYS } from '@crm/contracts';
import { POLICY_RULES } from './errors';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

function load(locale: string): Tree {
  const file = join(process.cwd(), 'messages', locale, 'auth-registration-security.json');
  const root = JSON.parse(readFileSync(file, 'utf8')) as Tree;
  return (root['auth-registration-security'] as Tree).guest as Tree;
}

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** ICU argument names used by a message: "{minutes, plural, ...}" -> minutes, "<terms>" tags -> terms. */
function placeholders(message: string): string[] {
  const args = [...message.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]!);
  const tags = [...message.matchAll(/<(\w+)>/g)].map((m) => m[1]!);
  return [...new Set([...args, ...tags])].sort();
}

describe('guest messages', () => {
  const en = flatten(load('en'));
  const ar = flatten(load('ar'));

  it('has the same keys in English and Arabic', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('uses the same ICU arguments in both languages', () => {
    for (const key of Object.keys(en)) {
      expect(placeholders(ar[key]!), key).toEqual(placeholders(en[key]!));
    }
  });

  it('has no empty messages and no dots in key names', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
    const tree = load('en');
    const walk = (t: Tree) => {
      for (const [k, v] of Object.entries(t)) {
        expect(k.includes('.'), k).toBe(false);
        if (typeof v !== 'string') walk(v);
      }
    };
    walk(tree);
  });

  it('ships original showcase copy for every optional field of both editable pages', () => {
    for (const page of ['login', 'register']) {
      for (const key of AUTH_PAGE_EXTRA_KEYS) {
        expect(en[`shell.defaults.${page}.${key}`], `${page}.${key}`).toBeTruthy();
      }
    }
  });

  it('has local copy for every text field the API can report as defaulted', () => {
    for (const page of ['login', 'register', 'forgot']) {
      for (const field of ['eyebrow', 'heading', 'headingAccent', 'subheading']) {
        expect(en[`shell.contentDefaults.${page}.${field}`], `${page}.${field}`).toBeTruthy();
      }
    }
  });

  it('has a localised text for every password rule we recognise', () => {
    for (const rule of POLICY_RULES) {
      expect(en[`errors.policyRules.${rule}`], rule).toBeTruthy();
      expect(ar[`errors.policyRules.${rule}`], rule).toBeTruthy();
    }
  });

  it('has a form header for each editable page', () => {
    for (const page of ['login', 'register', 'forgot']) {
      for (const part of ['eyebrow', 'title', 'accent', 'subtitle']) {
        expect(en[`shell.header.${page}.${part}`], `${page}.${part}`).toBeTruthy();
      }
    }
  });
});
