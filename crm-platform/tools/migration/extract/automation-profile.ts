import type { Source } from './source';
import type { Doc } from '../util';

/**
 * READ-ONLY: the distinct (class, function, shapeId / type) of the nodes of the advanced automations, with counts. NAMES and COUNTS
 * only: no node data, no value of a node, nothing that can hold a contact or a secret. It exists so the mapping of an automation node
 * to a flow node can be decided on the real dump (the pilot profiles keep only the counts of the node types).
 */
const ident = (v: unknown): string => {
  if (typeof v !== 'string') return v === null || v === undefined ? '(none)' : `(${typeof v})`;
  // an identifier (class / function / shape name or id), never free text
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : '(other text)';
};

export interface AutomationProfile {
  client: string;
  automationJourneyDocs: number;
  automationMetadataDocs: number;
  rows: Array<{ type: string; class: string; function: string; shape: string; count: number }>;
  metadataNodeShapes: Array<{
    type: string;
    class: string;
    function: string;
    shape: string;
    count: number;
  }>;
}

export async function automationProfile(
  source: Source,
  client: string,
): Promise<AutomationProfile> {
  const have = source.collections(client);
  const tally = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  let journey = 0;
  if (have.includes('automation_journey'))
    for await (const d of source.read(client, 'automation_journey')) {
      journey++;
      bump(
        tally,
        [ident(d.type), ident(d.class), ident(d.function), ident(d.shapeId)].join('\u0000'),
      );
    }
  const meta = new Map<string, number>();
  let metaDocs = 0;
  if (have.includes('automation_metadata'))
    for await (const d of source.read(client, 'automation_metadata')) {
      metaDocs++;
      const nodes = d.nodes && typeof d.nodes === 'object' ? Object.values(d.nodes as Doc) : [];
      for (const n of nodes as Doc[])
        if (n && typeof n === 'object')
          bump(
            meta,
            [ident(n.type), ident(n.class), ident(n.function), ident(n.shapeId)].join('\u0000'),
          );
    }
  const rows = (m: Map<string, number>): AutomationProfile['rows'] =>
    [...m]
      .map(([k, count]) => {
        const [type, cls, fn, shape] = k.split('\u0000') as [string, string, string, string];
        return { type, class: cls, function: fn, shape, count };
      })
      .sort(
        (a, b) =>
          b.count - a.count ||
          (a.type + a.class + a.function < b.type + b.class + b.function ? -1 : 1),
      );
  return {
    client,
    automationJourneyDocs: journey,
    automationMetadataDocs: metaDocs,
    rows: rows(tally),
    metadataNodeShapes: rows(meta),
  };
}

export function formatAutomationProfile(p: AutomationProfile): string {
  const line = (r: AutomationProfile['rows'][number]): string =>
    `  ${String(r.count).padStart(6)}  type=${r.type}  class=${r.class}  function=${r.function}  shape=${r.shape}`;
  return [
    `${p.client}: automation_journey ${p.automationJourneyDocs} rows, automation_metadata ${p.automationMetadataDocs} documents`,
    'automation_journey (one row per node):',
    ...(p.rows.length ? p.rows.map(line) : ['  (none)']),
    'automation_metadata.nodes (embedded nodes):',
    ...(p.metadataNodeShapes.length ? p.metadataNodeShapes.map(line) : ['  (none)']),
  ].join('\n');
}
