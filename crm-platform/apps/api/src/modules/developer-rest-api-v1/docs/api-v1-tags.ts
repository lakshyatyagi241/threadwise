/**
 * The reference's groups, in the order the page lists them, each with a short overview. The names are WaDesk's services (the docs page
 * and a client generated from the spec group by them); the text is ours.
 */
export const API_V1_TAGS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: 'Message',
    description:
      'Send a WhatsApp message to one number and read the history and delivery status of messages sent through the API.',
  },
  {
    name: 'Template',
    description:
      'List, create, change and delete message templates, and send one to a single number.',
  },
  { name: 'Media', description: 'Upload a file once and reuse it in messages and templates.' },
  {
    name: 'Contact',
    description:
      'The workspace address book: list, read, create, change and delete contacts, with free-form attributes.',
  },
  {
    name: 'ContactGroup',
    description: 'Named lists that contacts belong to: list, create and delete groups.',
  },
  {
    name: 'Broadcast',
    description:
      'One-off bulk sends of a template: create, list, read, see per-recipient status and stop.',
  },
  {
    name: 'Campaign',
    description:
      'Managed campaigns: create and dispatch, list, read live counts, read statistics, stop and delete.',
  },
  { name: 'Scheduled', description: 'Queue a message for a future time and manage the queue.' },
  { name: 'AutoReply', description: 'Keyword and automatic reply rules.' },
  {
    name: 'Flow',
    description: 'Read automation flows and enroll a contact into one by id or phone number.',
  },
  { name: 'Device', description: 'The connected sending numbers and their status.' },
  {
    name: 'Webhook',
    description:
      'Register endpoints to receive {{brand}} events (inbound messages, delivery status, contact and campaign changes) as signed JSON posts.',
  },
  {
    name: 'Deal',
    description:
      'The sales pipeline: list, read, create, change (including moving a stage) and delete deals.',
  },
  { name: 'Conversation', description: 'Read conversations and the messages inside them.' },
  {
    name: 'Account',
    description: 'The workspace behind the key: plan, limits, features, usage and credits.',
  },
];
