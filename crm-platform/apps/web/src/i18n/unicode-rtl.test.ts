import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from './locales';

/**
 * Unicode and right-to-left checks for the web app (QA task 14).
 *  1. Every translated string is well-formed text: no lone surrogates, no NUL, no replacement character, no byte-order mark, no
 *     mojibake (UTF-8 read as Latin-1), and no bidi override that could make text read differently from how it is stored.
 *  2. Every translation keeps the placeholders of the English text, so `{name}` is never lost or renamed in Arabic, Hebrew or Urdu.
 *  3. Layout classes: a physical `ml-`, `pr-`, `left-`, `text-right` and the like does not flip in a right-to-left language. The
 *     count per file may only go down (the baseline file is regenerated with `QA_UPDATE=1`).
 */
const MESSAGES = resolve(__dirname, '../../messages');
const SRC = resolve(__dirname, '..');

type Flat = Map<string, string>;
function flatten(prefix: string, v: unknown, out: Flat) {
  if (typeof v === 'string') out.set(prefix, v);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) flatten(prefix ? `${prefix}.${k}` : k, x, out);
}
function load(locale: string): Flat {
  const out: Flat = new Map();
  let files: string[] = [];
  try {
    files = readdirSync(join(MESSAGES, locale)).filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const f of files)
    flatten(
      f.replace(/\.json$/, ''),
      JSON.parse(readFileSync(join(MESSAGES, locale, f), 'utf8')),
      out,
    );
  return out;
}

const BIDI_OVERRIDES = /[‪-‮⁦-⁩]/;
const MOJIBAKE = /(?:Ã[\u0080-¿]|â€[\u0080-¿™œ“”˜]|Â[\u00A0-¿]|ï»¿)/;
const loneSurrogate = (s: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
/**
 * The argument names of an ICU message (`{name}`, `{count, plural, one {# day} other {# days}}`): the names the translation must keep.
 * The words that pick a plural form (`one`, `other`) and the text inside them are not arguments, but an argument used inside one is.
 */
export function icuArgs(message: string): string[] {
  const out: string[] = [];
  let i = 0;
  const upTo = (stops: string): string => {
    const start = i;
    while (i < message.length && !stops.includes(message[i]!)) i++;
    return message.slice(start, i).trim();
  };
  const text = (): void => {
    while (i < message.length && message[i] !== '}') {
      const c = message[i];
      const next = message[i + 1];
      if (c === "'" && next === "'")
        i += 2; // a doubled apostrophe is one apostrophe
      else if (c === "'" && (next === '{' || next === '}')) {
        // ICU quoting: '{{' and '}}' show braces as text, up to the closing apostrophe
        i++;
        while (i < message.length && message[i] !== "'") i++;
        i++;
      } else if (c === '{') {
        i++;
        argument();
      } else i++;
    }
  };
  const argument = (): void => {
    out.push(upTo(',}'));
    if (message[i] === '}') return void i++;
    i++; // the comma
    const kind = upTo(',}');
    if (message[i] === '}') return void i++;
    i++;
    if (kind === 'plural' || kind === 'select' || kind === 'selectordinal') {
      while (i < message.length && message[i] !== '}') {
        upTo('{}'); // the selector: one, other, =0, offset:1 other
        if (message[i] === '{') {
          i++;
          text();
          i++; // the closing brace of the option
        }
      }
      i++;
    } else {
      upTo('}'); // a number, date or time style
      i++;
    }
  };
  text();
  return [...new Set(out)].sort();
}
const args = icuArgs;

const en = load('en');

describe('translated text is well-formed', () => {
  it.each(LOCALES.map((l) => [l] as const))('%s', (locale) => {
    const bad: string[] = [];
    for (const [key, text] of load(locale)) {
      if (loneSurrogate(text)) bad.push(`${key}: lone surrogate`);
      if (text.includes('\u0000')) bad.push(`${key}: NUL`);
      if (text.includes('�')) bad.push(`${key}: replacement character`);
      if (text.includes('\uFEFF')) bad.push(`${key}: byte order mark`);
      if (MOJIBAKE.test(text)) bad.push(`${key}: mojibake`);
      if (BIDI_OVERRIDES.test(text)) bad.push(`${key}: bidi override or isolate control`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

describe('translations keep the placeholders of the English text', () => {
  it.each(LOCALES.filter((l) => l !== 'en').map((l) => [l] as const))('%s', (locale) => {
    const bad: string[] = [];
    for (const [key, text] of load(locale)) {
      const source = en.get(key);
      if (source === undefined) continue;
      const want = args(source).join(',');
      const got = args(text).join(',');
      if (want !== got) bad.push(`${key}: English has {${want}}, ${locale} has {${got}}`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

// --- layout classes -----------------------------------------------------------------------------------------------------------

const PHYSICAL =
  /(?<=["'`\s])(?:-?(?:ml|mr|pl|pr)-(?:\d|\[|auto|px)|-?(?:left|right)-(?:\d|\[|1\/|full|auto)|text-(?:left|right)(?=["'`\s]|$)|border-[lr](?=["'`\s-]|$)|rounded-(?:[lr]|tl|tr|bl|br)(?=["'`\s-]|$))/g;

function* tsx(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      yield* tsx(p);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) yield p;
  }
}

const BASELINE = resolve(__dirname, 'rtl-physical-baseline.json');

describe('layout classes that do not flip in right-to-left', () => {
  it('no file gains a physical left/right class, and the counts only go down', () => {
    const counts: Record<string, number> = {};
    for (const file of tsx(SRC)) {
      const n = (readFileSync(file, 'utf8').match(PHYSICAL) ?? []).length;
      if (n > 0) counts[relative(SRC, file)] = n;
    }
    if (process.env.QA_UPDATE) {
      writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
      return;
    }
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
    const grew = Object.entries(counts)
      .filter(([f, n]) => n > (base[f] ?? 0))
      .map(
        ([f, n]) =>
          `${f}: ${base[f] ?? 0} -> ${n} (use ms-, me-, ps-, pe-, start-, end-, text-start, text-end, rounded-s, rounded-e)`,
      );
    const shrunk = Object.entries(base)
      .filter(([f, n]) => (counts[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${n} -> ${counts[f] ?? 0}: lower the baseline`);
    expect(grew).toEqual([]);
    expect(shrunk).toEqual([]);
  });
});

describe('the placeholder reader', () => {
  it('reads plain, plural and select arguments, not the words that pick a form', () => {
    expect(icuArgs('Hi {name}, you have {count} items')).toEqual(['count', 'name']);
    expect(icuArgs('{count, plural, one {# day} other {# days}}')).toEqual(['count']);
    expect(icuArgs('{n, plural, =0 {none} one {{who} has one} other {{who} has #}}')).toEqual([
      'n',
      'who',
    ]);
    expect(icuArgs('{kind, select, list {the list} other {this {kind}}}')).toEqual(['kind']);
    expect(icuArgs('Plain text, no arguments')).toEqual([]);
    expect(icuArgs("Use '{{'variables'}}' and {name}; it''s fine")).toEqual(['name']);
  });
});
