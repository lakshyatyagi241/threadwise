#!/usr/bin/env node
// Breaking-change check between two OpenAPI 3 documents (QA task 8). A small stand-in for `oasdiff` so the check
// needs no extra binary. Usage:
//   node tools/quality/openapi-diff.mjs <base.json> <head.json> [--prefix /public/v1] [--json]
// Exit 1 when the head document breaks a caller of the base one. `--prefix` limits the check to paths starting with it
// (the external contract is /public/v1; internal routes may change with their frontend).
//
// Breaking for a caller:
//   - a path, method or success status code is removed
//   - a new required parameter, or a new required property in a request body, or an optional request body made required
//   - a property is removed from a success response, or a required response property becomes optional
//   - a property changes type, or a request enum loses a value
// Warnings (not failures): a response enum gains a value (strict clients may break), a new optional input, an added path.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

/** Follows a local $ref ("#/components/schemas/X"); returns the schema itself otherwise. */
export function deref(doc, schema, seen = new Set()) {
  let cur = schema;
  while (cur && typeof cur === 'object' && typeof cur.$ref === 'string') {
    if (seen.has(cur.$ref)) return {};
    seen.add(cur.$ref);
    const parts = cur.$ref.replace(/^#\//, '').split('/');
    cur = parts.reduce((o, k) => (o ? o[k] : undefined), doc) ?? {};
  }
  return cur ?? {};
}

const typeOf = (s) =>
  s.type
    ? Array.isArray(s.type)
      ? [...s.type].sort().join('|')
      : s.type
    : s.properties
      ? 'object'
      : s.items
        ? 'array'
        : s.enum
          ? 'enum'
          : 'any';

/**
 * Compares two schemas. `side` is 'request' (the head must accept what base accepted) or 'response' (the head must still
 * give what base gave). Pure; returns [{ severity, where, message }].
 */
export function diffSchema(baseDoc, headDoc, base, head, side, where, depth = 0, seen = new Set()) {
  const out = [];
  if (depth > 6) return out;
  // A recursive schema (a tag with a parent tag) is compared once per pair of $refs on the current path, not once per level.
  if (base?.$ref && head?.$ref) {
    const key = `${base.$ref}|${head.$ref}`;
    if (seen.has(key)) return out;
    seen = new Set(seen).add(key);
  }
  const b = deref(baseDoc, base);
  const h = deref(headDoc, head);
  const tb = typeOf(b);
  const th = typeOf(h);
  if (tb !== 'any' && th !== 'any' && tb !== th) {
    out.push({ severity: 'breaking', where, message: `type changed from ${tb} to ${th}` });
    return out;
  }
  if (b.enum && h.enum) {
    const lost = b.enum.filter((v) => !h.enum.includes(v));
    const gained = h.enum.filter((v) => !b.enum.includes(v));
    if (side === 'request' && lost.length)
      out.push({
        severity: 'breaking',
        where,
        message: `request enum lost ${JSON.stringify(lost)}`,
      });
    if (side === 'response' && gained.length)
      out.push({
        severity: 'warning',
        where,
        message: `response enum gained ${JSON.stringify(gained)}`,
      });
  }
  if (b.properties || h.properties) {
    const bp = b.properties ?? {};
    const hp = h.properties ?? {};
    const breq = new Set(b.required ?? []);
    const hreq = new Set(h.required ?? []);
    for (const k of Object.keys(bp)) {
      if (!(k in hp)) {
        if (side === 'response')
          out.push({
            severity: 'breaking',
            where: `${where}.${k}`,
            message: 'property removed from the response',
          });
        else
          out.push({
            severity: 'warning',
            where: `${where}.${k}`,
            message: 'request property no longer accepted',
          });
        continue;
      }
      if (side === 'response' && breq.has(k) && !hreq.has(k))
        out.push({
          severity: 'breaking',
          where: `${where}.${k}`,
          message: 'required response property became optional',
        });
      out.push(
        ...diffSchema(baseDoc, headDoc, bp[k], hp[k], side, `${where}.${k}`, depth + 1, seen),
      );
    }
    for (const k of Object.keys(hp)) {
      if (k in bp) continue;
      if (side === 'request' && hreq.has(k))
        out.push({
          severity: 'breaking',
          where: `${where}.${k}`,
          message: 'new required request property',
        });
      else if (side === 'request')
        out.push({
          severity: 'warning',
          where: `${where}.${k}`,
          message: 'new optional request property',
        });
    }
  }
  if (b.items && h.items)
    out.push(
      ...diffSchema(baseDoc, headDoc, b.items, h.items, side, `${where}[]`, depth + 1, seen),
    );
  return out;
}

const jsonSchemaOf = (doc, content) => {
  const c =
    content?.['application/json'] ??
    content?.['application/problem+json'] ??
    (content ? Object.values(content)[0] : undefined);
  return c?.schema;
};

const paramsOf = (doc, op, pathItem) => {
  const all = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])].map((p) => deref(doc, p));
  return new Map(all.map((p) => [`${p.in}:${p.name}`, p]));
};

/** Compares two documents. Pure. */
export function diffDocuments(baseDoc, headDoc, { prefix = '' } = {}) {
  const out = [];
  const bpaths = baseDoc.paths ?? {};
  const hpaths = headDoc.paths ?? {};
  const inScope = (p) => p.startsWith(prefix);
  for (const path of Object.keys(bpaths).filter(inScope).sort()) {
    if (!(path in hpaths)) {
      out.push({ severity: 'breaking', path, where: path, message: 'path removed' });
      continue;
    }
    for (const m of METHODS.filter((x) => bpaths[path][x])) {
      const route = `${m.toUpperCase()} ${path}`;
      const add = (items) =>
        items.forEach((i) =>
          out.push({ path, method: m, ...i, where: `${route} ${i.where}`.trim() }),
        );
      const bop = bpaths[path][m];
      const hop = hpaths[path][m];
      if (!hop) {
        out.push({
          severity: 'breaking',
          path,
          method: m,
          where: route,
          message: 'method removed',
        });
        continue;
      }
      const bparams = paramsOf(baseDoc, bop, bpaths[path]);
      const hparams = paramsOf(headDoc, hop, hpaths[path]);
      for (const [k, p] of hparams) {
        if (!bparams.has(k))
          add([
            {
              severity: p.required ? 'breaking' : 'warning',
              where: `parameter ${k}`,
              message: p.required ? 'new required parameter' : 'new optional parameter',
            },
          ]);
      }
      for (const [k, p] of bparams) {
        const q = hparams.get(k);
        if (q && !p.required && q.required)
          add([
            {
              severity: 'breaking',
              where: `parameter ${k}`,
              message: 'optional parameter became required',
            },
          ]);
        if (q)
          add(
            diffSchema(
              baseDoc,
              headDoc,
              p.schema ?? {},
              q.schema ?? {},
              'request',
              `parameter ${k}`,
            ),
          );
      }
      const bbody = deref(baseDoc, bop.requestBody ?? {});
      const hbody = deref(headDoc, hop.requestBody ?? {});
      if (!bbody.required && hbody.required)
        add([
          { severity: 'breaking', where: 'request body', message: 'request body became required' },
        ]);
      if (bbody.content && hbody.content)
        add(
          diffSchema(
            baseDoc,
            headDoc,
            jsonSchemaOf(baseDoc, bbody.content) ?? {},
            jsonSchemaOf(headDoc, hbody.content) ?? {},
            'request',
            'request',
          ),
        );
      for (const code of Object.keys(bop.responses ?? {}).filter((c) => /^2/.test(c))) {
        const hres = hop.responses?.[code];
        if (!hres) {
          add([
            {
              severity: 'breaking',
              where: `response ${code}`,
              message: 'success status code removed',
            },
          ]);
          continue;
        }
        const bs = jsonSchemaOf(baseDoc, deref(baseDoc, bop.responses[code]).content);
        const hs = jsonSchemaOf(headDoc, deref(headDoc, hres).content);
        if (bs && hs) add(diffSchema(baseDoc, headDoc, bs, hs, 'response', `response ${code}`));
        else if (bs && !hs)
          add([
            { severity: 'breaking', where: `response ${code}`, message: 'response body removed' },
          ]);
      }
    }
  }
  for (const path of Object.keys(hpaths).filter(inScope)) {
    if (!(path in bpaths))
      out.push({ severity: 'warning', path, where: path, message: 'path added' });
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--prefix');
  const pi = args.indexOf('--prefix');
  const prefix = pi > -1 ? args[pi + 1] : '';
  if (files.length !== 2) {
    console.error('usage: openapi-diff.mjs <base.json> <head.json> [--prefix /public/v1] [--json]');
    process.exit(2);
  }
  const [base, head] = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const diffs = diffDocuments(base, head, { prefix });
  const breaking = diffs.filter((d) => d.severity === 'breaking');
  if (args.includes('--json')) console.log(JSON.stringify(diffs, null, 2));
  else {
    for (const d of diffs)
      console.log(
        `${d.severity === 'breaking' ? 'BREAKING' : 'warning '}  ${d.where}: ${d.message}`,
      );
    console.log(
      `\n${breaking.length} breaking, ${diffs.length - breaking.length} warning(s)${prefix ? ` under ${prefix}` : ''}`,
    );
  }
  process.exit(breaking.length ? 1 : 0);
}
