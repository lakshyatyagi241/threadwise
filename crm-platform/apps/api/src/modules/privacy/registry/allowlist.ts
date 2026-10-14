/**
 * Tables the registry test found with a link to a person (a foreign key to contacts or conversations, a contact column, or a column
 * that holds a phone, an email, an IP or a person's name) that are NOT personal-data holders of a workspace's contacts, with the reason.
 *
 * A reason is a sentence a reviewer can disagree with. `follow_up` entries are real gaps we know about and record here (with the
 * backlog item) instead of hiding; the test counts them so the number can only go down on purpose.
 */
export type AllowKind =
  /** The data is a staff member's (a login, a session, an invitation), not a contact's. The platform answers staff requests (D11). */
  | 'staff'
  /** The workspace's own settings, connected accounts or business numbers: not a person's data. */
  | 'workspace'
  /** Owned by the platform operator, not by a workspace (a workspace's data request does not reach it). */
  | 'platform'
  /** The column holds no personal value (a flag, a count, the address of a machine). */
  | 'not_personal'
  /** A known gap, recorded with its follow-up. */
  | 'follow_up';

export interface AllowEntry {
  kind: AllowKind;
  reason: string;
}

const staff = (reason: string): AllowEntry => ({ kind: 'staff', reason });
const workspace = (reason: string): AllowEntry => ({ kind: 'workspace', reason });
const platform = (reason: string): AllowEntry => ({ kind: 'platform', reason });
const notPersonal = (reason: string): AllowEntry => ({ kind: 'not_personal', reason });
const followUp = (reason: string): AllowEntry => ({ kind: 'follow_up', reason });

export const PRIVACY_ALLOWLIST: Readonly<Record<string, AllowEntry>> = {
  // ---- staff: the platform answers staff requests (decision D11); the workspace-level rights service does not touch them ----------
  users: staff(
    'Staff accounts (email, full name). A staff member is not a contact; account deletion and a leaver\'s export are the platform\'s (privacy spec D11, backlog BL-143 follow-up "staff subject").',
  ),
  user_profiles: staff('Staff profile (phone). Same owner and follow-up as users.'),
  auth_sessions: staff('Staff login sessions (IP, user agent). Retention is gap G15 of the privacy spec (backlog BL-146).'),
  security_events: staff('Security trail of staff logins and changes (IP, user agent); an audit store by design (G15, BL-146).'),
  impersonation_sessions: staff('Operator act-as sessions (IP, user agent); the access record itself (ADR-0020), kept for accountability.'),
  device_risk_acknowledgements: staff('A staff member\'s acknowledgement of the personal-WhatsApp risk (user agent as evidence).'),
  social_identities: staff('A staff member\'s social login identity (email).'),
  team_chat_invitations: staff('Invitations of staff to team chat (invitee name and email); not a contact.'),
  partner_agents: staff('External partner agents who submit leads (their own login phone and email); they are users of the workspace, not contacts.'),
  support_tickets: staff('Tickets a staff member sent to the platform support desk (email); the platform answers them.'),
  appointment_calendar_connections: staff('The calendar account a staff member connected (account email), not a booking invitee.'),
  orders: staff('The workspace\'s own billing orders to the platform (the billing contact\'s name and email); financial record kept by the platform (ADR-0028).'),
  packages: notPersonal('Plan catalogue row; `access_email` is a plan access setting, not a person.'),

  // ---- workspace: the workspace's own settings, accounts and business numbers -----------------------------------------------------
  devices: workspace('The workspace\'s own connected WhatsApp numbers and their proxy egress address; business lines, not contacts.'),
  wa_provider_configs: workspace('The workspace\'s own WhatsApp Business numbers and credentials.'),
  wa_groups: workspace('WhatsApp group rows keep the workspace device number that owns the group; the members are registered as wa_group_members.'),
  wa_chat_links: workspace('Click-to-chat links: the number is the workspace\'s own business line.'),
  meta_campaigns: workspace('Click-to-WhatsApp campaign settings: `ctwa_phone` is the workspace\'s own number.'),
  invoice_settings: workspace('The seller\'s own invoice details (support email, phone) as configured by the workspace.'),
  hubspot_integrations: workspace('The connected HubSpot portal account (email of the portal owner).'),
  shopify_integrations: workspace('The connected Shopify shop (shop owner email).'),
  workspace_email_accounts: workspace('The workspace\'s own sending mailboxes (addresses of the business).'),
  telegram_accounts: workspace('The workspace\'s own connected Telegram account (name and phone of the business account).'),
  chatbot_widgets: notPersonal('Widget settings: `collect_phone` and `collect_email` are switches saying what the widget asks for.'),
  workspace_settings: notPersonal('Workspace switches; `skip_onboarding_email` is a flag.'),
  marketplace_inbound_events: notPersonal('Deliveries pushed by a lead portal: `source_ip` is the portal\'s server address, not a visitor.'),

  // ---- platform: the operator\'s own data ------------------------------------------------------------------------------------------
  platform_operators: platform('Operator staff of the platform (name, email); outside any workspace.'),
  platform_sessions: platform('Operator login sessions (IP, user agent); outside any workspace.'),
  contact_messages: platform('Messages sent through the platform\'s own marketing-site contact form (no workspace); the platform answers them.'),

  // ---- follow-ups we know about ----------------------------------------------------------------------------------------------------
  companies: followUp(
    'Company records (business email and phone). A company is a business entity, but a sole trader\'s card is personal data; a person-level request does not reach companies yet. BL-143 follow-up: companies linked through contacts.company_id.',
  ),
};
