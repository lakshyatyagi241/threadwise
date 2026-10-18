/**
 * The instructions the flow generator gives the model (TW-FLB-025). The chat prompt names exactly the node types and
 * handle conventions Reference's does; the voice prompt is used for call flows. Written once here so a unit test can pin that
 * every node type the prompt offers exists in the catalogue.
 */

/** The node types the chat prompt teaches (Reference's list; media, code, MySQL, sub-flow, Google and channel nodes are not in it). */
export const CHAT_PROMPT_NODE_TYPES = [
  'trigger',
  'message',
  'sequence',
  'ask',
  'buttons',
  'list',
  'condition',
  'delay',
  'template',
  'ai',
  'cta',
  'location',
  'poll',
  'tag',
  'assign',
  'webhook',
  'book_appointment',
  'whatsapp_shop',
  'woocommerce',
  'shopify',
  'end',
] as const;

export const CALL_PROMPT_NODE_TYPES = [
  'trigger',
  'cf_say',
  'cf_listen',
  'cf_ai',
  'cf_menu',
  'cf_search',
  'cf_transfer',
  'cf_hangup',
] as const;

const SCHEMA = `{
  "flowNodes": [ { "id": "n_<short>", "type": "<type>", "x": <int>, "y": <int>, "data": { ... } } ],
  "flowEdges": [ { "id": "e_<short>", "source": "<nodeId>", "sourceHandle": "<handle>", "target": "<nodeId>" } ]
}`;

export const CHAT_SYSTEM_PROMPT = `You design WhatsApp chat flows as JSON. Output STRICT JSON only: no prose, no markdown, no code fences. The schema is:

${SCHEMA}

Available node types and their data shapes:
  trigger:         { kind: "keyword"|"qr"|"start", keywords: "hi, hello" }
  message:         { text: "..." }
  sequence:        { replies: [{ type: "text"|"image"|"video"|"audio"|"document", text|url, caption?, filename? }] }
  ask:             { prompt: "...", var: "name", validate?: "email"|"phone"|"number", options?: ["yes","no"] } (when options are given they render as choices with ports p0,p1,... plus "else"; wire an edge from EACH option port)
  buttons:         { prompt: "...", options: ["A","B","C"], var: "choice" } (max 3 options; ports p0,p1,p2)
  list:            { prompt: "...", options: ["A","B",...], button: "View", var: "choice" } (up to 10; ports p0,p1,...)
  condition:       { conditions: [{ variable: "{{name}}", operator: "equals"|"not_equals"|"contains"|"not_contains"|"gt"|"lt"|"exists", value: "x" }], operators: ["AND"|"OR"] } (ports: yes / no)
  delay:           { unit: "sec"|"min"|"hour"|"day", amount: 5 }
  template:        { tpl: "<template_name>", preview: "..." }
  ai:              { model: "gpt-4o-mini", prompt: "system prompt", save: "reply" }
  cta:             { actions: [{ type: "url"|"phone"|"copy", label: "Visit", value: "https://..." }] } (max 3)
  location:        { title: "...", address: "...", lat: "<real latitude, -90..90>", lng: "<real longitude, -180..180>" }
  poll:            { question: "...", options: ["A","B"] }
  tag:             { action: "add"|"remove", tag: "<name>", tagId?: "<id>" }
  assign:          { team: "<team>", userId?: "<user>", message: "internal note" }
  webhook:         { method: "GET"|"POST", url: "https://...", body: "...", save: "response", contentType: "application/json" }
  book_appointment:{ slotCount: 5, prompt: "Pick a time", confirmation: "Booked!" } (ports: booked / no_slots)
  whatsapp_shop:   { storeId: "<catalog_id>", productItems: [{retailer_id:"sku", name:"...", price_minor:0, currency:""}], headerText:"", bodyText:"...", abandonedWaitMinutes: 5 } (ports: purchased / abandoned)
  woocommerce:     same shape as whatsapp_shop, storeId is the WooCommerce integration id
  shopify:         same shape as whatsapp_shop, storeId is the Shopify integration id
  end:             {}

Edge handles (sourceHandle):
  - Default port: "out"
  - Multi-option (buttons, list, poll, and an "ask" node that has options): "p0","p1","p2"... one per option, plus "else" for no match. Wire an edge from EVERY option port you define; never collapse an options node to a single "out" edge.
  - Condition: "yes" or "no"
  - book_appointment: "booked" or "no_slots"
  - Commerce nodes: "purchased" or "abandoned"

Rules:
1. Always include exactly ONE "trigger" node as flowNodes[0].
2. End every branch with an "end" or with a terminal "message" plus "end".
3. Layout left to right: increment x by 360 each step; y=200 for the main lane, plus or minus 260 for branches.
4. Make ids unique: "n_" plus 6 lowercase alphanumerics for nodes, "e_" for edges.
5. Use {{var}} merge tags in messages to reference variables set by upstream "ask" nodes.
6. Do NOT use emojis anywhere.
7. Keep the flow concise: at most 12 nodes.

Output ONLY the JSON object. No explanation. No code fences.`;

export const CALL_SYSTEM_PROMPT = `You design AI VOICE CALL flows (phone IVR) as JSON. Output STRICT JSON only: no prose, no markdown, no code fences. The schema is:

${SCHEMA}

This is a VOICE call flow. Use ONLY these node types; do NOT use chat nodes (message / ask / buttons / list / template etc.):
  trigger:     { kind: "start" }                                   (the inbound call; exactly one, flowNodes[0])
  cf_say:      { text: "spoken line" }                             (text-to-speech to the caller)
  cf_listen:   { save: "caller_said", silenceTimeout: 6 }          (capture caller speech into a variable)
  cf_ai:       { model: "gpt-4o-mini", prompt: "system prompt", save: "ai_reply", endOnGoodbye: true }  (AI answers, spoken back)
  cf_menu:     { mode: "intent", options: [ { match: "sales", label: "Sales" }, { match: "support", label: "Support" } ] }  (route by caller intent; one port per option: p0,p1,p2...)
  cf_search:   { query: "{{caller_said}}", save: "search", filler: "One moment, let me check that." }  (look up the web into a variable)
  cf_transfer: { number: "", message: "Connecting you to an agent now." }  (hand the call to a human)
  cf_hangup:   { goodbye: "Thanks for calling. Goodbye!" }         (end the call; terminal)

Edge handles (sourceHandle):
  - Default port: "out"
  - cf_menu: one port per option, in order: "p0","p1","p2"...

Rules:
1. Always include exactly ONE "trigger" node as flowNodes[0], then a cf_say greeting.
2. End EVERY branch with cf_hangup (or cf_transfer). Never leave a branch open.
3. To ask the caller something: cf_say the question, then cf_listen to capture the reply, then act on it (cf_ai / cf_menu / cf_search).
4. Layout left to right: increment x by 360 each step; y=200 for the main lane, plus or minus 260 for branches.
5. Make ids unique: "n_" plus 6 lowercase alphanumerics for nodes, "e_" for edges.
6. Use {{var}} merge tags to reference variables captured by cf_listen / cf_search / cf_ai.
7. Do NOT use emojis anywhere.
8. Keep the flow concise: at most 12 nodes.

Output ONLY the JSON object. No explanation. No code fences.`;

/**
 * The model's text to a graph candidate: strip code fences wherever they appear, slice to the OUTERMOST `{...}` (leading or
 * trailing chatter no longer breaks it), decode, and require a `flowNodes` array. Null when it is not a flow.
 */
export function extractFlowJson(
  raw: string,
): { flowNodes: unknown[]; flowEdges: unknown[] } | null {
  let clean = raw.trim().replace(/```(?:json)?/gi, '');
  clean = clean.replace(/^[\s`\0]+|[\s`\0]+$/g, '');
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first !== -1 && last > first) clean = clean.slice(first, last + 1);
  try {
    const j = JSON.parse(clean) as { flowNodes?: unknown; flowEdges?: unknown } | null;
    if (!j || typeof j !== 'object' || !Array.isArray(j.flowNodes)) return null;
    return { flowNodes: j.flowNodes, flowEdges: Array.isArray(j.flowEdges) ? j.flowEdges : [] };
  } catch {
    return null;
  }
}
