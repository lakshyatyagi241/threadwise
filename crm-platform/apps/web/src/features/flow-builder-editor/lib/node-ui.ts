/**
 * The look of each node type: chip colours and the 16px-grid icon path (Reference's builder palette). The catalogue
 * (label, group, channels, ports) is in @crm/contracts; this is only how a node is drawn. Colours that are Reference's brand
 * green and mint are theme tokens (`--brand`, `--flb-mint`), never literals.
 */
export interface NodeLook {
  bg: string;
  fg: string;
  icon: string;
}

const MINT = 'var(--flb-mint)';
const DEEP = 'var(--brand)';
const PLUM = 'var(--flb-plum)';

const l = (bg: string, fg: string, icon: string): NodeLook => ({ bg, fg, icon });

const CIRCLE_AI =
  'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M3.5 12.5l1.5-1.5M11 5l1.5-1.5';
const WA_HANDOFF =
  'M3 8a5 5 0 0 1 5-5M8 3a5 5 0 0 1 0 10M8 13H3v-5M10.5 8.2a3 3 0 0 1-3.2 3 3.3 3.3 0 0 1-1.4-.3L4 11.5l.6-1.8a3 3 0 1 1 5.9-1.5z';
const LEAD = 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13c0-2.2 2.2-3.5 5-3.5s5 1.3 5 3.5';
const BAG = 'M3 5.5h10l-1 7.5H4zM5.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5';

export const NODE_LOOK: Record<string, NodeLook> = {
  trigger: l(MINT, DEEP, 'M5 3l8 5-8 5z'),
  message: l(
    MINT,
    DEEP,
    'M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v3A2.5 2.5 0 0 1 10.5 11H8l-3.5 2v-2A2.5 2.5 0 0 1 3 8.5v-3Z',
  ),
  template: l('#D9E5F2', '#13478A', 'M2.5 2.5h11v11h-11zM2.5 6h11M6 13.5V6'),
  media: l(
    '#FFF4E0',
    '#7B5A14',
    'M2 3h12v10H2zM6 7m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0M3 11l3-3 4 4 3-3 0 4',
  ),
  notify_number: l(
    '#E8F0FE',
    '#1A73E8',
    'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13c0-2.2 2.2-3.5 5-3.5M11 9.5v4M9 11.5h4',
  ),
  wa_to_instagram: l(
    '#FCE7F3',
    '#9D174D',
    'M4 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM11.5 4h.01',
  ),
  sequence: l(MINT, DEEP, 'M2 4h12M2 8h12M2 12h8M13 11l2 2-2 2'),
  buttons: l(MINT, DEEP, 'M2.5 2.5h11v5h-7l-3 3v-8Z M2.5 11h11 M2.5 13.5h11'),
  list: l(MINT, DEEP, 'M2.5 2.5h11v11h-11zM5 6h6M5 8h6M5 10h4'),
  ask: l(
    '#FBE9E7',
    '#A1431F',
    'M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM6 6.5a2 2 0 0 1 4 0c0 1.5-2 1.5-2 3M8 12.5h.01',
  ),
  // Not Reference nodes (TW-FLB-081, 082). Ask for file: the peach chip of the input nodes with a paperclip; Ask for location:
  // a pale-green chip with a navigation arrow (the Location send node keeps its amber pin).
  ask_file: l(
    '#FFE4D6',
    '#A1431F',
    'M13 7.5l-5 5a3.2 3.2 0 0 1-4.5-4.5l5.5-5.5a2.1 2.1 0 0 1 3 3L6.5 10.5a1 1 0 0 1-1.5-1.5L10 4',
  ),
  ask_location: l(MINT, DEEP, 'M14 2L2 7.5l5 1.5 1.5 5z'),
  condition: l('#F3E9FF', PLUM, 'M8 2v3M5 8l3-3 3 3M8 5v9'),
  delay: l('#FFF4E0', '#7B5A14', 'M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM8 5v3l2 2'),
  webhook: l('#E8F5E9', DEEP, 'M3 8h3l1.5-4 2 8 1.5-4h2'),
  code: l('#1E2A33', '#7CF3C4', 'M6 4L2.5 8 6 12M10 4l3.5 4L10 12'),
  mysql: l(
    '#E6F4EA',
    '#137333',
    'M3 4c0-1 2.2-1.8 5-1.8s5 .8 5 1.8v8c0 1-2.2 1.8-5 1.8s-5-.8-5-1.8zM3 4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8',
  ),
  ai: l('#F3E9FF', PLUM, CIRCLE_AI),
  tag: l('#D9E5F2', '#13478A', 'M3 3h6l5 5-6 6-5-5zM6 6m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0'),
  assign: l(
    MINT,
    DEEP,
    'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 14c0-3 2.5-5 4-5s4 2 4 5M11.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M10.5 10c1.9.2 3.5 1.7 3.5 4',
  ),
  subflow: l(
    '#F3E9FF',
    PLUM,
    'M3.5 8a1.8 1.8 0 1 0 0-0.01M12.5 3.5a1.8 1.8 0 1 0 0-0.01M12.5 12.5a1.8 1.8 0 1 0 0-0.01M5 7l6-3M5 9l6 3',
  ),
  end: l('#FBE9E7', '#A1431F', 'M3 3h10v10H3z'),
  cta: l('#FFE4D6', '#A1431F', 'M3 8h7M7 5l3 3-3 3M11 3h2v10h-2'),
  location: l(
    '#FFF4E0',
    '#7B5A14',
    'M8 1.5C5.5 1.5 3.5 3.4 3.5 5.7c0 3 4.5 8.8 4.5 8.8s4.5-5.8 4.5-8.8C12.5 3.4 10.5 1.5 8 1.5zM8 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  ),
  poll: l('#F3E9FF', PLUM, 'M3 13V7M7 13V3M11 13v-5'),
  chatbot: l(MINT, DEEP, 'M4 4h8v6H8l-2 2v-2H4zM6 7h.01M10 7h.01'),
  whatsapp_shop: l(MINT, DEEP, 'M3 5h10l-1 7H4zM5 5V3.5a3 3 0 0 1 6 0V5'),
  woocommerce: l('#F3E9FF', PLUM, 'M2 4h12v6H2zM4 11l1 2M12 11l-1 2'),
  shopify: l(MINT, DEEP, 'M5 4l-1 9 8 1V4l-2-1-2 1-3 0z'),
  book_appointment: l('#E8F0FE', '#1A73E8', 'M3 4h10v9H3zM3 6h10M5 2v3M11 2v3M6 9h2M9 9h1'),
  ai_call: l(
    '#E8F0FE',
    '#1A73E8',
    'M3.5 3.5a1.5 1.5 0 0 1 1.5-1.5h1.6l1.2 3-1.4 1a8.5 8.5 0 0 0 4.6 4.6l1-1.4 3 1.2v1.6a1.5 1.5 0 0 1-1.5 1.5C7 14 2 9 2 5z',
  ),
  google_meet: l('#E8F0FE', '#1A73E8', 'M2 5h7v6H2zM10 6l3-1.5v7L10 10z'),
  wa_form: l(MINT, DEEP, 'M3 2h10v12H3zM5 5h6M5 8h6M5 11h4'),
  // Not a Reference node: a speech bubble with a question mark, in the AI group's plum.
  faq: l(
    '#F3E9FF',
    PLUM,
    'M3 2.5h10v8H8.5L5 13.5v-3H3zM6.6 5.6a1.4 1.4 0 0 1 2.8 0c0 1-1.4 1.1-1.4 2M8 9h.01',
  ),
  api_library: l('#E8F5E9', DEEP, 'M6 4L2.5 8 6 12M10 4l3.5 4L10 12M9 3.5l-2 9'),
  google_sheets: l('#E6F4EA', '#137333', 'M3 2h10v12H3zM3 5h10M3 8h10M3 11h10M6.5 5v9M9.5 5v9'),
  google_docs: l('#E8F0FE', '#1A73E8', 'M3 2h7l3 3v9H3zM10 2v3h3M5 8h6M5 10h6M5 12h4'),
  google_form: l('#F3E8FD', '#7B2CBF', 'M3 2h10v12H3zM5 5h2M5 8h2M5 11h2M9 5h2M9 8h2M9 11h2'),
  deal: l('#DFF1ED', DEEP, 'M2 12V8l6-5 6 5v4M2 12h12M6 12V9h4v3'),
  update_contact: l(
    '#D9E5F2',
    '#13478A',
    'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14c0-3 2.5-5 5.5-5M10 12l1.5 1.5L14.5 10',
  ),
  list_member: l('#D9E5F2', '#13478A', 'M3 4h7M3 8h7M3 12h4M12 9v5M9.5 11.5h5'),
  in_list: l('#F3E9FF', PLUM, 'M3 4h5M3 8h5M3 12h3M10.5 9.5l1.5 1.5 3-3'),
  in_segment: l('#F3E9FF', PLUM, 'M2 3h12l-4.5 5.5V13l-3-1.5V8.5z'),
  wa_session: l('#FFF4E0', '#7B5A14', 'M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM8 5v3.5l2.5 1.5'),
  sheet_check: l('#E6F4EA', '#137333', 'M3 2h10v12H3zM3 5h10M3 8h10M3 11h10M6.5 5v9M9.5 5v9'),
  sheet_contact: l('#E6F4EA', '#137333', 'M3 2h10v12H3zM3 5h10M3 8h10M6.5 5v9'),

  cf_say: l('#EAF6FF', '#0B5FA5', 'M3 6h6l3-3v10l-3-3H3zM13 6.5a2 2 0 0 1 0 3'),
  cf_listen: l('#FBE9E7', '#A1431F', 'M5 8a3 3 0 0 1 6 0v3a3 3 0 0 1-6 0zM3 8v3M13 8v3M8 14v1'),
  cf_ai: l('#F3E9FF', PLUM, 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2'),
  cf_assistant: l(
    '#F3E9FF',
    PLUM,
    'M8 1.6a3 3 0 0 1 3 3V7a3 3 0 0 1-6 0V4.6a3 3 0 0 1 3-3zM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.4M5.5 14.4h5',
  ),
  cf_menu: l('#F3E9FF', PLUM, 'M8 2v3M5 8l3-3 3 3M3 13h2M11 13h2M7 13h2'),
  cf_search: l('#E8F5E9', DEEP, 'M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2zM11 11l3 3'),
  cf_transfer: l(
    '#FFF4E0',
    '#7B5A14',
    'M2 11V5a2 2 0 0 1 2-2h4M14 5v6a2 2 0 0 1-2 2H8M10 1l3 3-3 3M6 15l-3-3 3-3',
  ),
  cf_hangup: l('#FBE9E7', '#A1431F', 'M3 9c3-3 7-3 10 0l-1.5 1.5-2-1V7.5a6 6 0 0 0-3 0V9l-2 1z'),

  ig_send_dm: l('#FCE7F3', '#9D174D', 'M2 4h12v8H6l-4 3z'),
  ig_quick: l('#F3E9FF', PLUM, 'M2 4h12v6H6l-2 2zM4.5 7h2M8 7h3.5'),
  ig_buttons: l('#EAF6FF', '#0B5FA5', 'M2 4h12v8H2zM4.5 9h3M9 9h2.5'),
  ig_reply_comment: l('#FFF4E0', '#7B5A14', 'M2 5h12v7H9l-3 2v-2H2z'),
  ig_ai: l('#F3E9FF', PLUM, 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2'),
  ig_products: l('#E8F5E9', '#166534', BAG),
  ig_ask: l('#EAF6FF', '#0B5FA5', 'M6 5.5a2 2 0 1 1 2.6 1.9c-.6.2-.9.6-.9 1.2M8 11h.01'),
  ig_lead: l('#FEF3C7', '#92400E', LEAD),
  ig_to_whatsapp: l('#DCFCE7', '#166534', WA_HANDOFF),

  fb_gallery: l('#E7F0FF', '#1877F2', 'M2 4h12v8H2zM2 9l3-3 3 3 2-2 2 2'),
  fb_products: l('#E7F0FF', '#1877F2', BAG),
  fb_lead: l('#E7F0FF', '#1877F2', LEAD),
  fb_reply_comment: l('#E7F0FF', '#1877F2', 'M2 5h12v7H9l-3 2v-2H2z'),
  fb_to_whatsapp: l('#DCFCE7', '#166534', WA_HANDOFF),

  tg_payment: l('#EAF6FC', '#1B7CB0', 'M2 4h12v8H2zM2 7h12M4.5 10h3'),
};

/** Unknown types (a graph from the future) still render, in a neutral chip. */
export const lookOf = (type: string): NodeLook =>
  NODE_LOOK[type] ?? l('var(--muted)', 'var(--muted-foreground)', 'M3 3h10v10H3z');
