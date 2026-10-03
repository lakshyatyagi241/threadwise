import {
  ERROR_CODES,
  FLOW_CATEGORY_MAX,
  FLOW_EXPORT_MARKER,
  flbIsFlowType,
  flbNormalizeGraph,
  type FlowGraph,
  type FlowState,
  type FlowStatusFilter,
  type FlowType,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/**
 * Pure rules of the flow builder module (TW-FLB-001, 006, 008, 009, 010): the state filter, the list cursor, the import
 * payload parser, export file names. Kept out of the repository and service so a unit test can pin each one without a
 * database.
 */

/** The SQL predicate (over `flows`) of a status tab. `all` has none. */
export function statusPredicate(status: FlowStatusFilter): string | null {
  switch (status) {
    case 'live':
      return 'f.is_published AND f.is_active';
    case 'paused':
      return 'f.is_published AND NOT f.is_active';
    case 'draft':
      return 'NOT f.is_published';
    default:
      return null;
  }
}

/** The same split for one row, mirroring `statusPredicate` (a unit test keeps the two in step). */
export function stateOf(isPublished: boolean, isActive: boolean): FlowState {
  if (!isPublished) return 'draft';
  return isActive ? 'live' : 'paused';
}

/** Escapes `%`, `_` and `\` so a search box value is matched literally by ILIKE. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The list keyset: `updated_at` (as a microsecond ISO string, a JS Date keeps milliseconds only) and the id as tiebreaker.
 * Reference ordered by `updated_at` descending, which is not unique, so the id makes the resume point exact.
 */
export function encodeFlowCursor(updatedAtIso: string, id: number): string {
  return Buffer.from(`${updatedAtIso}|${id}`, 'utf8').toString('base64url');
}

export function decodeFlowCursor(raw: string): { updatedAtIso: string; id: number } {
  try {
    const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!iso || !id || !/^\d+$/.test(id) || Number.isNaN(new Date(iso).getTime())) {
      throw new Error('malformed');
    }
    return { updatedAtIso: iso, id: Number(id) };
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
}


/**
 * `name + suffix` within `max` characters (code points; the flows table caps a name at 255): a long name is cut and the suffix
 * stays, so a copy still reads "... (Copy)". Reference's column had no such cap.
 */
export function nameWithSuffix(name: string, suffix: string, max = 255): string {
  const chars = [...name];
  const room = max - [...suffix].length;
  return (chars.length > room ? chars.slice(0, room).join('') : name) + suffix;
}

export interface ParsedImport {
  name: string;
  flowType: FlowType;
  category: string | null;
  graph: FlowGraph;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads an export file (the canonical wrapper `{ _threadwise_flow_export, name, flow_type, category, flow_data }`) or a bare
 * `{ flowNodes, flowEdges, vars }` graph (TW-FLB-009). `flowNodes` must be an array; edges and vars default to empty. A
 * `flow_type` outside the ten channels falls back to chat. The graph is normalised (ids, defaults, grid positions for nodes
 * that have none, one start node). `suffix` is appended to the name: ` (imported)`.
 */
export function parseImportPayload(raw: unknown, opts: { suffix?: string; brand?: string } = {}): ParsedImport {
  // Reference: "This is not a valid <brand> flow export."
  const message = `This is not a valid ${opts.brand ? `${opts.brand} ` : ''}flow export.`;
  const invalid = () =>
    new AppError(ERROR_CODES.FLB_IMPORT_INVALID, message, 422, [{ path: 'file', message }]);
  if (!isRecord(raw)) throw invalid();

  const wrapped = FLOW_EXPORT_MARKER in raw || isRecord(raw.flow_data);
  const graphSrc = wrapped ? raw.flow_data : raw;
  if (!isRecord(graphSrc) || !Array.isArray(graphSrc.flowNodes)) throw invalid();

  const rawName = wrapped && typeof raw.name === 'string' ? raw.name.trim() : '';
  const flowType = wrapped && flbIsFlowType(raw.flow_type) ? raw.flow_type : 'chat';
  const rawCategory = wrapped && typeof raw.category === 'string' ? raw.category.trim() : '';

  const name = nameWithSuffix(rawName || 'Imported flow', opts.suffix ?? '');
  return {
    name,
    flowType,
    category: rawCategory ? rawCategory.slice(0, FLOW_CATEGORY_MAX) : null,
    graph: flbNormalizeGraph({
      flowNodes: graphSrc.flowNodes,
      flowEdges: Array.isArray(graphSrc.flowEdges) ? graphSrc.flowEdges : [],
      vars: Array.isArray(graphSrc.vars) ? graphSrc.vars : [],
    }),
  };
}

/** The card bullet "Auto · on tag" and friends (TW-FLB-001 rule 5): only three kinds have a label of their own. */
export function triggerLabel(kind: string): string {
  switch (kind) {
    case 'tag_added':
      return 'Auto · on tag';
    case 'group_join':
      return 'Auto · on group join';
    case 'manual_enroll':
      return 'Manual enroll';
    default:
      return 'Keyword';
  }
}

/**
 * `<slug>.threadwise-flow.json`, the download name Reference's export uses: Laravel's `Str::slug` (accents folded, `_` is a separator,
 * `@` reads "at", every other punctuation mark is dropped, not turned into a dash) and `flow-<id>` when nothing is left.
 */
export function flowExportFileName(name: string, fallbackId: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/_+/g, '-')
    .replace(/@/g, '-at-')
    .replace(/[^-a-z0-9\s]+/g, '')
    .replace(/[-\s]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || `flow-${fallbackId}`}.threadwise-flow.json`;
}
