#!/usr/bin/env node
// Acceptance-criteria extractor (QA task 6).
// Reads docs/threadwise-port/inventory/*.md and writes docs/quality/acceptance/acceptance.json: one record per
// Given/When/Then line, with the feature id, its status and priority, and a stable criterion id.
//   criterion id = AC-<feature id>-<n>   (n counts from 1 inside the feature, in file order)
// Usage: node tools/quality/extract-acceptance.mjs [--check]   (--check fails when the committed file is stale)
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Headings use an em dash, a hyphen or a colon: "### TW-X-001 — Title", "### TW-X-001: Title".
const FEATURE_RE = /^### (TW-[A-Z0-9]+-\d+)\s*(?:[—-]|:)\s*(.+?)\s*$/;
const FIELD_RE = /^- \*\*([^:*]+):\*\*\s*(.*)$/;

/** Priority line looks like "P0 (product unusable without)": keep the P-number. */
export const priorityOf = (v) => /^P[0-3]/.exec(v.trim())?.[0] ?? null;

/** Status text is a word ("implemented") or a phrase ("not in Reference (port addition: ...)"); keep one stable word. */
export const statusOf = (v) => {
  const t = v.trim();
  if (/^not in reference/i.test(t)) return 'port-addition';
  return (/^[A-Za-z][A-Za-z-]*/.exec(t)?.[0] ?? '').toLowerCase() || null;
};

/**
 * Parses one inventory markdown file into feature records. Pure.
 * A feature starts at "### TW-XXX-NNN — title". Its "- **Acceptance criteria:**" field owns the indented
 * "  - ..." lines that follow, until the next "- **Field:**" line or the next heading.
 */
export function parseInventory(markdown, domain, groups = []) {
  const features = [];
  let cur = null;
  let inAc = false;
  for (const raw of markdown.split('\n')) {
    const h = FEATURE_RE.exec(raw);
    if (h) {
      cur = { id: h[1], title: h[2], domain, status: null, priority: null, criteria: [] };
      features.push(cur);
      inAc = false;
      continue;
    }
    if (/^### TW-[A-Z0-9]+-\d+ to \d+/.test(raw)) {
      // A grouped heading ("### TW-CAMP-025 to 028") describes several features together: it has no criteria of its own.
      groups.push(raw.replace(/^### /, '').trim());
    }
    if (/^#{1,3} /.test(raw)) {
      cur = null;
      inAc = false;
      continue;
    }
    if (!cur) continue;
    const f = FIELD_RE.exec(raw);
    if (f) {
      const name = f[1].trim().toLowerCase();
      inAc = name === 'acceptance criteria';
      if (name === 'status') cur.status = statusOf(f[2]);
      if (name === 'priority') cur.priority = priorityOf(f[2]);
      // Some files put several fields on one line: "- **Status:** pending. **Priority:** P0. **Effort:** M."
      for (const extra of f[2].matchAll(/\*\*([^:*]+):\*\*\s*([^*]*)/g)) {
        const n = extra[1].trim().toLowerCase();
        if (n === 'priority') cur.priority = priorityOf(extra[2]);
        if (n === 'status') cur.status = statusOf(extra[2]);
      }
      if (inAc && f[2].trim()) cur.criteria.push(f[2].trim());
      continue;
    }
    if (inAc) {
      const item = /^\s{2,}[-*]\s+(.*\S)\s*$/.exec(raw);
      if (item) cur.criteria.push(item[1]);
      else if (/^\s*$/.test(raw)) continue;
      else if (!/^\s{3,}\S/.test(raw)) inAc = false; // a continuation line stays; anything else ends the list
    }
  }
  return features.map((f) => ({
    ...f,
    criteria: f.criteria.map((text, i) => ({ id: `AC-${f.id}-${i + 1}`, n: i + 1, text })),
  }));
}

/** Flat list for the JSON file. */
export function flatten(features) {
  return features.flatMap((f) =>
    f.criteria.map((c) => ({
      id: c.id,
      feature: f.id,
      domain: f.domain,
      status: f.status,
      priority: f.priority,
      title: f.title,
      text: c.text,
    })),
  );
}

export function buildAll(inventoryDir, groups = []) {
  const features = [];
  for (const file of readdirSync(inventoryDir)
    .filter((n) => n.endsWith('.md'))
    .sort()) {
    features.push(
      ...parseInventory(
        readFileSync(join(inventoryDir, file), 'utf8'),
        file.replace(/\.md$/, ''),
        groups,
      ),
    );
  }
  return features;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const groups = [];
  const features = buildAll(join(root, 'docs/threadwise-port/inventory'), groups);
  const criteria = flatten(features);
  const out = join(root, 'docs/quality/acceptance/acceptance.json');
  const body =
    // One criterion per line keeps the diff readable when an inventory file changes.
    `{\n"generatedBy": "tools/quality/extract-acceptance.mjs",\n"features": ${features.length},\n"featuresWithoutCriteria": ${JSON.stringify(
      features.filter((f) => f.criteria.length === 0).map((f) => f.id),
    )},\n"groupHeadings": ${JSON.stringify(groups)},\n"criteria": [\n${criteria.map((c) => JSON.stringify(c)).join(',\n')}\n]\n}\n`;
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== body) {
      console.error(
        'docs/quality/acceptance/acceptance.json is stale: run node tools/quality/extract-acceptance.mjs',
      );
      process.exit(1);
    }
    console.log('acceptance.json is up to date');
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
    console.log(
      `${features.length} features, ${criteria.length} criteria -> docs/quality/acceptance/acceptance.json`,
    );
  }
}
