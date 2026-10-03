import type { FlbBuilderContext, FlowNode, FlbTemplateButtonRef } from '@crm/contracts';

type Template = FlbBuilderContext['templates'][number];

/** The approved template a Send-template node points at, by name or id. */
export function findTemplate(templates: readonly Template[], nameOrId: unknown): Template | null {
  if (nameOrId === null || nameOrId === undefined || nameOrId === '') return null;
  const key = String(nameOrId);
  return templates.find((t) => t.name === key || t.id === key) ?? null;
}

const label = (b: Record<string, unknown>, i: number): string =>
  String(b.text ?? b.title ?? b.label ?? `Button ${i + 1}`);

/**
 * Quick-reply buttons of a node's template. ONLY quick replies send a tap-back that can branch a flow; URL, call and
 * copy-code buttons do not reply, so they never become ports. Each returned button is one output port of the node.
 */
export function templateQuickReplies(
  templates: readonly Template[],
  node: Pick<FlowNode, 'data'>,
): FlbTemplateButtonRef[] {
  const t = findTemplate(templates, node.data.tpl ?? node.data.tplId);
  const buttons = (t?.buttons ?? []) as Array<Record<string, unknown>>;
  return buttons
    .filter((b) => {
      const k = String(b.type ?? b.button_type ?? '').toLowerCase();
      return !(
        k.includes('url') || k.includes('cta') || k.includes('visit') ||
        k.includes('call') || k.includes('phone') || k.includes('copy')
      );
    })
    .map((b, i) => ({ label: label(b, i) }));
}
