import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccessConfig } from '../access/config';
import { bool, docKeys, isDeleted, str, type Doc } from '../util';
import type { Source } from './source';

/**
 * The one-time read the permission map needs: every Waboo permission of a client (the `available_permissions` catalogue plus every
 * entry of every live role's permission_config) and whether permission-map.json maps it yet. Names, ids and counts only: no flag
 * values, no role names, nothing about a person. A reviewer takes the `unmapped` list and fills in the map.
 */
export interface CatalogueRow {
  id: string;
  name: string;
  label: string;
  type: string;
  hasCrud: boolean | null;
  /** In the catalogue (available_permissions) or only seen inside a role. */
  inCatalogue: boolean;
  /** How many live roles have it accessible. */
  rolesWithAccess: number;
  status: 'mapped' | 'unreviewed' | 'unmapped';
  /** An UNREVIEWED suggestion by product area, never applied. */
  candidate: string | null;
}

async function all(source: Source, client: string, collection: string): Promise<Doc[]> {
  if (!source.collections(client).includes(collection)) return [];
  const out: Doc[] = [];
  for await (const d of source.read(client, collection)) out.push(d);
  return out;
}

export async function permissionCatalogue(
  source: Source,
  client: string,
  cfg: AccessConfig,
): Promise<CatalogueRow[]> {
  const rows = new Map<string, CatalogueRow>();
  const blank = (id: string): CatalogueRow => ({
    id,
    name: '',
    label: '',
    type: '',
    hasCrud: null,
    inCatalogue: false,
    rolesWithAccess: 0,
    status: 'unmapped',
    candidate: null,
  });
  for (const p of await all(source, client, 'available_permissions')) {
    const id = str(p.id) ?? docKeys(p)[0]?.key;
    if (!id) continue;
    const r = rows.get(id) ?? blank(id);
    r.name = str(p.name) ?? '';
    r.label = str(p.Label) ?? str(p.label) ?? '';
    r.type = str(p.type) ?? '';
    r.hasCrud = p.has_crud === undefined ? null : bool(p.has_crud);
    r.inCatalogue = true;
    rows.set(id, r);
  }
  for (const role of await all(source, client, 'roles')) {
    if (isDeleted(role) || !Array.isArray(role.permission_config)) continue;
    const seen = new Set<string>();
    for (const e of role.permission_config) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
      const o = e as Doc;
      const regular = Boolean(str(o.id) || str(o.name));
      const idents = regular
        ? [str(o.id) ?? str(o.name)!]
        : Object.entries(o)
            .filter(([k, v]) => !['id', 'name'].includes(k) && bool(v))
            .map(([k]) => k);
      for (const ident of idents) {
        const r = rows.get(ident) ?? blank(ident);
        if (!r.name && str(o.name)) r.name = str(o.name)!;
        if ((!regular || bool(o.is_accessible)) && !seen.has(ident)) {
          r.rolesWithAccess++;
          seen.add(ident);
        }
        rows.set(ident, r);
      }
    }
  }
  const entries = cfg.permissionMap.entries;
  for (const r of rows.values()) {
    const hit = [r.id, r.name]
      .map((k) => (k && Object.hasOwn(entries, k) ? entries[k] : undefined))
      .find(Boolean);
    if (hit) r.status = hit.status === 'REVIEWED' && hit.reviewedBy ? 'mapped' : 'unreviewed';
    const hay = `${r.id} ${r.name} ${r.label}`;
    r.candidate =
      (cfg.permissionMap.candidates ?? []).find((c) => new RegExp(c.match, 'i').test(hay))?.area ??
      null;
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function catalogueMarkdown(client: string, rows: CatalogueRow[]): string {
  const todo = rows.filter((r) => r.status !== 'mapped');
  const L = [
    `# Waboo permissions to map: ${client}`,
    '',
    `${rows.length} permissions seen, ${rows.length - todo.length} mapped and reviewed, ${todo.length} still to map. An unmapped permission grants NOTHING in crm-platform.`,
    'Fill access/permission-map.json (status REVIEWED + reviewedBy) for the ones that should grant something. The suggestion column is an UNREVIEWED guess by product area, never applied.',
    '',
    '| id | name | label | type | crud | in catalogue | roles with access | status | suggestion |',
    '|---|---|---|---|---|---|---:|---|---|',
  ];
  for (const r of todo)
    L.push(
      `| ${r.id} | ${r.name} | ${r.label} | ${r.type} | ${r.hasCrud ?? ''} | ${r.inCatalogue ? 'yes' : 'ROLE ONLY'} | ${r.rolesWithAccess} | ${r.status} | ${r.candidate ?? ''} |`,
    );
  L.push('');
  return L.join('\n');
}

export function writeCatalogue(client: string, rows: CatalogueRow[], outDir: string): string {
  const dir = join(outDir, client);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'permission-catalogue.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(dir, 'permission-catalogue.md'), catalogueMarkdown(client, rows));
  return join(dir, 'permission-catalogue.md');
}
