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
 * Where "Open" goes. The flow decides, whatever the workspace's builder setting: a bot (see `isSimpleBot`) opens in the Simple builder,
 * and an automation (a messaging flow built on the canvas, a call flow) opens on the Advanced canvas with every node.
 */
export function openHref(id: string, flowType: FlowType | string, builder?: string | null): string {
  return isSimpleBot(flowType, builder) ? `/flows/simple/${id}` : `/flows/builder/${id}`;
}

/** Where "Create flow" goes for a bot: the Simple builder, with the channel in the link. Automations are created from the create sheet's Advanced rows. */
export function newHref(channel: 'chat' | 'web' = 'chat'): string {
  return channel === 'web' ? '/flows/simple?type=web' : '/flows/simple';
}
