/** The entries of a list row's actions menu, in order, for what the role may do. Everyone who can read can open and see the logs. */
export type RowAction = 'edit' | 'view' | 'logs' | 'delete';

export function rowActions(can: { update: boolean; delete: boolean }): RowAction[] {
  return [can.update ? 'edit' : 'view', 'logs', ...(can.delete ? (['delete'] as const) : [])];
}
