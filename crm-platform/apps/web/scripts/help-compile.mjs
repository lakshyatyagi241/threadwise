// Compiles the help files (`features/<domain>/help/*.md`) into the data `help.generated.ts` holds.
// Plain Node (no TypeScript, no dependency) because `scripts/gen-registry.mjs` runs it before anything else is built;
// `help-compile.d.mts` types it for the app and the tests. Pure: strings in, docs out, errors thrown.
//
// A file is frontmatter (a small `key: value` subset, no YAML library) and a body in a restricted markdown subset:
// `##`/`###` headings, paragraphs, `-` and `1.` lists, `> ` callouts, **bold**, `code`, and links that are app paths or
// `help:<doc-id>`. Nothing else, so nothing needs sanitising and a doc can only point inside the app.

export const AREA_IDS = [
  'overview',
  'inbox',
  'audience',
  'sales',
  'campaigns',
  'automation',
  'store',
  'apps',
  'settings',
  'account',
  'getting-started',
  'troubleshooting',
];

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DOCUMENT_RE = /^(nav|tile):[a-z0-9][a-z0-9_-]*$/;
const SUMMARY_MAX = 160;
const TOP_KEYS = new Set([
  'id',
  'title',
  'summary',
  'area',
  'order',
  'documents',
  'gates',
  'keywords',
  'routes',
  'audience',
]);
const GATE_KEYS = new Set(['planFeature', 'permission', 'channel']);
const TRANSLATION_KEYS = new Set(['id', 'title', 'summary']);

const fail = (where, message) => {
  throw new Error(`${where}: ${message}`);
};

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const unquote = (v) => {
  const s = v.trim();
  return s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))
    ? s.slice(1, -1)
    : s;
};

/** `[a, b]` -> ['a', 'b']; anything else -> null. */
const flowList = (v) => {
  const s = v.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const inner = s.slice(1, -1).trim();
  return inner === '' ? [] : inner.split(',').map((x) => unquote(x));
};

function splitFrontmatter(text, where) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') fail(where, 'must start with a --- frontmatter block');
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) fail(where, 'frontmatter is not closed with ---');
  return { front: lines.slice(1, end), body: lines.slice(end + 1) };
}

/** The frontmatter subset: scalars, `[a, b]` lists, and one nested map (`gates:` with indented `key: value` lines). */
function parseFront(lines, where) {
  const out = {};
  let map = null;
  for (const raw of lines) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const nested = /^ {2,}([A-Za-z]+):\s*(.*)$/.exec(raw);
    if (nested && map) {
      const [, key, value] = nested;
      if (!GATE_KEYS.has(key))
        fail(where, `unknown gate "${key}" (use planFeature, permission or channel)`);
      if (value.trim().startsWith('['))
        fail(where, `gates.${key} must be a single key, not a list`);
      map[key] = unquote(value);
      continue;
    }
    const top = /^([A-Za-z]+):(?:\s(.*))?$/.exec(raw);
    if (!top) fail(where, `cannot read frontmatter line "${raw.trim()}"`);
    const [, key, value = ''] = top;
    if (!TOP_KEYS.has(key)) fail(where, `unknown frontmatter key "${key}"`);
    if (key === 'gates') {
      if (value.trim() !== '') fail(where, 'gates must be a block of indented key: value lines');
      map = {};
      out.gates = map;
      continue;
    }
    map = null;
    out[key] = flowList(value) ?? unquote(value);
  }
  return out;
}

const asList = (value, key, where, example) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(where, `${key} must be a list like ${example}`);
  return value;
};

function readMeta(front, where, translation) {
  const allowed = translation ? TRANSLATION_KEYS : TOP_KEYS;
  for (const key of Object.keys(front)) {
    if (!allowed.has(key))
      fail(where, `a translation file may only set id, title and summary, not "${key}"`);
  }
  for (const key of ['id', 'title', 'summary']) {
    if (typeof front[key] !== 'string' || front[key].trim() === '')
      fail(where, `${key} is required`);
  }
  if (!ID_RE.test(front.id))
    fail(where, `id "${front.id}" must be kebab-case (letters, digits, hyphens)`);
  if (front.summary.length > SUMMARY_MAX) {
    fail(where, `summary is ${front.summary.length} characters; the limit is ${SUMMARY_MAX}`);
  }
  const meta = { id: front.id, title: front.title.trim(), summary: front.summary.trim() };
  if (translation) return meta;

  if (!AREA_IDS.includes(front.area)) {
    fail(where, `area "${front.area ?? ''}" is not one of ${AREA_IDS.join(', ')}`);
  }
  let order = 100;
  if (front.order !== undefined) {
    if (typeof front.order !== 'string' || !/^-?\d+$/.test(front.order))
      fail(where, 'order must be a whole number');
    order = Number(front.order);
  }
  const audience = front.audience ?? 'workspace';
  if (audience !== 'workspace' && audience !== 'operator')
    fail(where, 'audience must be workspace or operator');
  const documents = asList(front.documents, 'documents', where, '[nav:contacts, tile:tax-rates]');
  for (const d of documents) {
    if (!DOCUMENT_RE.test(d))
      fail(where, `documents entry "${d}" must look like nav:<id> or tile:<id>`);
  }
  const routes = asList(front.routes, 'routes', where, '[/contacts]');
  for (const r of routes) {
    if (!r.startsWith('/') || r.startsWith('//'))
      fail(where, `routes entry "${r}" must be an app path starting with /`);
  }
  return {
    ...meta,
    area: front.area,
    order,
    documents,
    gates: front.gates ?? {},
    keywords: asList(front.keywords, 'keywords', where, '[people, leads]'),
    routes,
    audience,
  };
}

/** Inline runs: **bold**, `code`, [text](/path) and [text](help:id). Collects the help: targets it meets. */
function parseInline(text, where, links) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const j = text.indexOf('**', i + 2);
      if (j > i + 2) {
        flush();
        out.push({ t: 'bold', v: text.slice(i + 2, j) });
        i = j + 2;
        continue;
      }
    }
    if (text[i] === '`') {
      const j = text.indexOf('`', i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: 'code', v: text.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (text[i] === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (m) {
        const [whole, label, target] = m;
        flush();
        const help = /^help:(.+)$/.exec(target);
        if (help) {
          if (!ID_RE.test(help[1])) fail(where, `link target ${target} is not a valid doc id`);
          links.push({ where, target: help[1] });
          out.push({ t: 'doc', v: label, doc: help[1] });
        } else if (target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')) {
          out.push({ t: 'link', v: label, href: target });
        } else {
          fail(
            where,
            `link target ${target} must be an app path starting with / or help:<doc-id> (no external links)`,
          );
        }
        i += whole.length;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return out;
}

const BLOCK_START = /^(#{1,6}\s|[-*]\s|\d+\.\s|>)/;

function parseBody(lines, where, links) {
  const blocks = [];
  const used = new Set();
  let headings = 0;
  let i = 0;
  const take = (re) => {
    const items = [];
    while (i < lines.length) {
      const m = re.exec(lines[i]);
      if (!m) break;
      items.push(m[1]);
      i += 1;
    }
    return items;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (line.startsWith('```')) fail(where, 'code fences are not supported');
    if (/<\/?[a-zA-Z!][^>]*>/.test(line.replace(/`[^`]*`/g, '')))
      fail(where, 'raw HTML is not allowed');
    if (line.includes('![')) fail(where, 'images are not supported');
    if (line.startsWith('|')) fail(where, 'tables are not supported');

    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (level === 1)
        fail(
          where,
          '# headings are not allowed (the title comes from the frontmatter); start at ##',
        );
      if (level > 3) fail(where, `${heading[1]} headings are not supported; use ## or ###`);
      headings += 1;
      const base = slugify(heading[2]) || `section-${headings}`;
      let id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
      used.add(id);
      blocks.push({ t: 'h', level, id, text: heading[2] });
      i += 1;
    } else if (/^[-*]\s/.test(line)) {
      blocks.push({
        t: 'ul',
        items: take(/^[-*]\s+(.*)$/).map((s) => parseInline(s, where, links)),
      });
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({
        t: 'ol',
        items: take(/^\d+\.\s+(.*)$/).map((s) => parseInline(s, where, links)),
      });
    } else if (line.startsWith('>')) {
      const text = take(/^>\s?(.*)$/)
        .join(' ')
        .trim();
      blocks.push({ t: 'note', inline: parseInline(text, where, links) });
    } else {
      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !BLOCK_START.test(lines[i]) &&
        !lines[i].startsWith('```')
      ) {
        if (/<\/?[a-zA-Z!][^>]*>/.test(lines[i].replace(/`[^`]*`/g, '')))
          fail(where, 'raw HTML is not allowed');
        if (lines[i].includes('![')) fail(where, 'images are not supported');
        if (lines[i].startsWith('|')) fail(where, 'tables are not supported');
        para.push(lines[i].trim());
        i += 1;
      }
      blocks.push({ t: 'p', inline: parseInline(para.join(' '), where, links) });
    }
  }
  return blocks;
}

const FILE_RE = /^([a-z0-9-]+)\.md$/;
const TRANSLATION_FILE_RE = /^([a-z0-9-]+)\.([a-z]{2}(?:-[A-Za-z]+)?)\.md$/;

export function compileRegistry(files) {
  const links = [];
  const groups = new Map();
  for (const f of [...files].sort((a, b) =>
    `${a.domain}/${a.file}`.localeCompare(`${b.domain}/${b.file}`),
  )) {
    const where = `${f.domain}/help/${f.file}`;
    const tr = TRANSLATION_FILE_RE.exec(f.file);
    const en = FILE_RE.exec(f.file);
    if (!tr && !en) fail(where, 'file name must be <slug>.md or <slug>.<locale>.md');
    const slug = (tr ?? en)[1];
    const key = `${f.domain}/${slug}`;
    const group = groups.get(key) ?? { domain: f.domain, english: null, translations: [] };
    groups.set(key, group);
    const { front, body } = splitFrontmatter(f.source, where);
    const meta = readMeta(parseFront(front, where), where, Boolean(tr));
    const text = {
      title: meta.title,
      summary: meta.summary,
      blocks: parseBody(body, where, links),
    };
    if (tr) group.translations.push({ where, locale: tr[2], meta, text });
    else group.english = { where, meta, text };
  }

  const docs = [];
  const seen = new Map();
  for (const [key, group] of groups) {
    if (!group.english) {
      fail(
        `${key.split('/')[0]}/help/${key.split('/')[1]}.${group.translations[0].locale}.md`,
        'a translation needs an English <slug>.md beside it',
      );
    }
    const { meta, text, where } = group.english;
    if (seen.has(meta.id)) fail(where, `duplicate id "${meta.id}" (also in ${seen.get(meta.id)})`);
    seen.set(meta.id, where);
    const doc = {
      id: meta.id,
      area: meta.area,
      order: meta.order,
      documents: meta.documents,
      gates: meta.gates,
      keywords: meta.keywords,
      routes: meta.routes,
      audience: meta.audience,
      domain: group.domain,
      text: { en: text },
    };
    for (const t of group.translations) {
      if (t.meta.id !== meta.id)
        fail(t.where, `id must match the English file (${meta.id}), found ${t.meta.id}`);
      doc.text[t.locale] = t.text;
    }
    docs.push(doc);
  }

  for (const { where, target } of links) {
    if (!seen.has(target)) fail(where, `link to help:${target}: no doc with that id`);
  }
  return docs;
}

export function renderGenerated(docs) {
  return [
    '// GENERATED by scripts/gen-registry.mjs. Do not edit; do not commit.',
    "import type { HelpDoc } from '../help-center/types';",
    `export const HELP_DOCS: HelpDoc[] = ${JSON.stringify(docs)};`,
    '',
  ].join('\n');
}
