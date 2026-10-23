import type { FlowType } from '@crm/contracts';

/** The builder a workspace uses: its own choice (Flows > Builder) or else the platform default (Admin > Platform settings > Flow builder). */
export type BuilderMode = 'simple' | 'advanced';

/**
 * The editor a saved flow belongs to, whatever the workspace uses. A website chat bot is always a Simple bot. A WhatsApp flow is a
 * Simple bot unless it was saved on the Advanced canvas (`builder: 'advanced'`): that is a messaging automation and stays on the canvas.
 * Call flows and every other channel are automations.
 */
export function isSimpleBot(flowType: FlowType | string, builder?: string | null): boolean {
  if (flowType === 'web') return true;
  return flowType === 'chat' && builder !== 'advanced';
}

/**
 * Where "Open" goes. In a workspace on the Advanced builder every flow is an automation and opens on the canvas with the automation nodes.
 * Otherwise a bot (see `isSimpleBot`) opens in the Simple builder, and an automation (the canvas: a messaging flow built on it, and call
 * flows) opens on the Advanced canvas. Pass the flow's `builder` too: the flow decides, not only its type.
 */
export function openHref(
  id: string,
  flowType: FlowType | string,
  mode: BuilderMode = 'simple',
  builder?: string | null,
): string {
  if (mode === 'advanced') return `/flows/builder/${id}`;
  return isSimpleBot(flowType, builder) ? `/flows/simple/${id}` : `/flows/builder/${id}`;
}

/** Where "Create flow" goes for a bot: the Simple builder, with the channel in the link. Automations are created from the create sheet's Advanced rows. */
export function newHref(channel: 'chat' | 'web' = 'chat'): string {
  return channel === 'web' ? '/flows/simple?type=web' : '/flows/simple';
}
