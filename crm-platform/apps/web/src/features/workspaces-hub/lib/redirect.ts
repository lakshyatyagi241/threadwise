type Params = Record<string, string | string[] | undefined>;

/**
 * Where an old list address (workspace plans, workspace wallets, support customers, provider assignments) sends the operator.
 * A search (`q`, or the old lists' `search`) carries over so links like "open this workspace's plan" still land on that workspace.
 */
export function hubRedirectPath(params: Params = {}): string {
  const raw = params.q ?? params.search;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return q ? `/admin/workspaces?q=${encodeURIComponent(q.slice(0, 120))}` : '/admin/workspaces';
}
