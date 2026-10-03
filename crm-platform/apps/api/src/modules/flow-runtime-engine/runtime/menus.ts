import type { RuntimeNode } from '../graph/runtime-graph';
import type { ListRow, MenuItem } from './types';

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Cloud API caps (TW-FLR-019 rule 2). */
export const BUTTON_TITLE_MAX = 20;
export const LIST_TITLE_MAX = 24;
export const LIST_DESCRIPTION_MAX = 72;
export const LIST_ROWS_MAX = 10;
export const REPLY_BUTTONS_MAX = 3;

/**
 * The options of an Ask node with expected answers: `opt_<i>` ids and the text the author typed (TW-FLR-022). The ids are plain
 * because an Ask offers its answers as buttons only on channels that have them; typing the text or its number works everywhere.
 */
export function askItems(node: RuntimeNode, render: (t: unknown) => string): MenuItem[] {
  return arr(node.props.expectedAnswers).map((o, i) => ({ id: `opt_${i}`, text: render(o) }));
}

/**
 * The buttons of a Buttons node. Ids are scoped to the node (`b_<nodeId>_p<i>`): a bare `p0` is shared by every menu, and a customer
 * can tap an older menu's button at any time (TW-FLR-018 rule 4). A label with `{{tags}}` is resolved now.
 */
export function buttonItems(node: RuntimeNode, render: (t: unknown) => string): MenuItem[] {
  return arr(node.props.buttons).map((b, i) => {
    const text = render(obj(b).title).trim() || `Option ${i + 1}`;
    return { id: `b_${node.id}_p${i}`, text };
  });
}

/**
 * The rows of a List node, grouped into sections in order of first appearance (TW-FLR-018). The row's index IS its output port, so
 * grouping never renumbers: every row carries its `port` home. Items without a section share one group titled with the button text.
 */
export function listRows(node: RuntimeNode): ListRow[] {
  const items = arr(node.props.items).slice(0, LIST_ROWS_MAX);
  return items.map((raw, i) => {
    const it = obj(raw);
    return {
      id: `list_${node.id}_p${i}`,
      title: s(it.title) || `Option ${i + 1}`,
      section: s(it.section).trim() || s(node.props.buttonText) || 'Options',
      port: i + 1,
    };
  });
}

/** The rows in the order they are rendered (section by section): a typed digit means a position in THIS order. */
export function renderedListRows(node: RuntimeNode): ListRow[] {
  const rows = listRows(node);
  const order: string[] = [];
  for (const r of rows) if (!order.includes(r.section)) order.push(r.section);
  return order.flatMap((section) => rows.filter((r) => r.section === section));
}
