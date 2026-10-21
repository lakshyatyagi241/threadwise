/**
 * The permission each Home card and quick action needs, the same key its screen's nav entry uses. A card whose key the caller does not
 * hold is not drawn; a card with no entry here is drawn as before (persona hiding still applies). The API keeps its own checks: this
 * only shapes what the screen shows.
 */
export const CARD_PERMISSION: Readonly<Record<string, string>> = {
  sent: 'dash.dashboard.read',
  read: 'dash.dashboard.read',
  throughput: 'dash.dashboard.read',
  activity: 'dash.dashboard.read',
  contacts: 'record.contacts.read',
  wallet: 'wallet.balance.read',
  instagram: 'ig.accounts.read',
  pipeline: 'record.deals.read',
  funnel: 'record.deals.read',
  campaigns: 'camp.campaigns.read',
  devices: 'wa.devices.read',
  templates: 'tpl.templates.read',
  inbox: 'inbox.conversation.read',
  copilot: 'flb.flows.read',
  flows: 'flb.flows.read',
};

/** Quick access tiles by catalogue key (the shell's pinnable pages). A pinned page the caller cannot open is not drawn. */
export const QUICK_ACCESS_PERMISSION: Readonly<Record<string, string>> = {
  inbox: 'inbox.conversation.read',
  contacts: 'record.contacts.read',
  campaigns: 'camp.campaigns.read',
  templates: 'tpl.templates.read',
  flows: 'flb.flows.read',
  scheduled: 'sched.schedules.read',
  catalog: 'cat.catalog.read',
  store: 'store.dashboard.read',
  deals: 'record.deals.read',
  analytics: 'dash.analytics.read',
  appointments: 'record.appointments.read',
  devices: 'wa.devices.read',
  history: 'msg.history.read',
};

/** The three quick actions on the Home quick actions card. */
export const QUICK_ACTION_PERMISSION: Readonly<Record<string, string>> = {
  broadcast: 'camp.campaigns.create',
  flow: 'flb.flows.read',
  template: 'tpl.templates.read',
};

/** True when there is no key to check, or the caller holds it. */
export function permitted(permissions: Readonly<Record<string, unknown>>, key?: string): boolean {
  return !key || key in permissions;
}
