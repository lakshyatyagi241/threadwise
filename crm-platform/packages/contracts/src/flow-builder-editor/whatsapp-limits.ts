/**
 * WhatsApp Cloud API limits for the messages a bot sends from the flow builder. One table, read by the Simple builder, the
 * Advanced builder, the save/publish guard in the API and the runtime renderer, so the inputs, the server and the wire agree.
 *
 * Source: Meta's WhatsApp Business Platform documentation (developers.facebook.com/documentation/business-messaging/whatsapp):
 *  - messages/interactive-reply-buttons-messages (reply buttons): 1 to 3 buttons, title 20, button id 256, body 1024, header 60, footer 60
 *  - messages/interactive-list-messages (list): body 4096, 10 rows in all, row title 24, row description 72, row id 200, section title 24,
 *    list button 20, header 60, footer 60
 *  - messages/interactive-cta-url-messages (CTA URL): button text 20, one URL button, body 1024, header 60, footer 60
 *  - direct-send/supported-features-and-limits and the template components reference (body 1024, header/footer 60)
 *  - messages/text-messages: a plain text body is 4096
 * Checked against the live pages on 2026-10-18. Meta publishes no length for a CTA URL; `ctaUrl` is the common 2000-character URL
 * cap, kept as a conservative check.
 * Website chat bots are not bound by any of this; callers apply it to WhatsApp flows only (`flowType` `chat`).
 *
 * Lengths are counted in UTF-16 code units (`string.length`), which is also what `maxLength` on an input counts, so an input
 * that stops at the limit is never rejected by the server.
 */
export const FLB_WA_LIMITS = {
  replyButtons: 3,
  buttonTitle: 20,
  replyId: 256,
  body: 1024,
  /** A list message's body is the exception: Meta allows 4096 (reply buttons and link buttons, 1024). */
  listBody: 4096,
  header: 60,
  footer: 60,
  listRows: 10,
  listSections: 10,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
  sectionTitle: 24,
  listButton: 20,
  ctaText: 20,
  ctaUrl: 2000,
  ctaActions: 3,
  text: 4096,
  /** A text-only Ask turns its expected answers into reply buttons (up to 3) or list rows (up to 10). */
  askOptions: 10,
} as const;

/** The longest label an Ask answer may have: reply buttons (up to 3 answers) are 20, list rows (4 to 10) are 24. */
export const flbAskOptionMax = (count: number): number =>
  count <= FLB_WA_LIMITS.replyButtons ? FLB_WA_LIMITS.buttonTitle : FLB_WA_LIMITS.rowTitle;

export interface FlbWaProblem {
  nodeId: string;
  /** A sentence the editor can show as it is. */
  message: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * Checks every WhatsApp-bound text of the buttons, list, link-button (CTA), plain message and Ask nodes against Meta's limits.
 * Only over-long text, too many items and duplicate button titles are reported; empty fields are left to the existing checks.
 */
export function flbWhatsappLimitProblems(
  nodes: ReadonlyArray<{ id: string; type: string; data?: Record<string, unknown> | null }>,
): FlbWaProblem[] {
  const L = FLB_WA_LIMITS;
  const out: FlbWaProblem[] = [];
  for (const n of nodes) {
    const d = rec(n.data);
    const add = (message: string) => out.push({ nodeId: n.id, message });
    const over = (what: string, v: unknown, max: number) => {
      if (text(v).length > max) add(`${what} is longer than ${max} characters.`);
    };
    switch (n.type) {
      case 'message':
        over('The message', d.text, L.text);
        break;
      case 'buttons': {
        const opts = list(d.options).map((o) => text(rec(o).title ?? o));
        over('The text above the buttons', d.prompt, L.body);
        if (opts.length > L.replyButtons)
          add(`A WhatsApp buttons message has at most ${L.replyButtons} buttons.`);
        opts.forEach((o, i) => over(`Button ${i + 1}`, o, L.buttonTitle));
        const seen = new Set<string>();
        for (const o of opts.map((x) => x.trim().toLowerCase()).filter(Boolean)) {
          if (seen.has(o)) {
            add('Two buttons have the same name. WhatsApp needs each button name to be different.');
            break;
          }
          seen.add(o);
        }
        break;
      }
      case 'list': {
        const rows = list(d.options).map((o) =>
          typeof o === 'string'
            ? { title: o, description: '', section: '' }
            : {
                title: text(rec(o).title),
                description: text(rec(o).description),
                section: text(rec(o).section),
              },
        );
        over('The text above the list', d.prompt, L.listBody);
        over('The list button', d.button, L.listButton);
        if (rows.length > L.listRows) add(`A WhatsApp list has at most ${L.listRows} items.`);
        if (new Set(rows.map((r) => r.section.trim())).size > L.listSections)
          add(`A WhatsApp list has at most ${L.listSections} sections.`);
        rows.forEach((r, i) => {
          over(`List item ${i + 1}`, r.title, L.rowTitle);
          over(`The description of list item ${i + 1}`, r.description, L.rowDescription);
          over(`The section of list item ${i + 1}`, r.section, L.sectionTitle);
        });
        break;
      }
      case 'cta': {
        const actions = list(d.actions).map(rec);
        over('The text above the link buttons', d.bodyText, L.body);
        over('The header', d.headerText, L.header);
        over('The footer', d.footerText, L.footer);
        if (actions.length > L.ctaActions)
          add(`A link buttons step has at most ${L.ctaActions} buttons.`);
        actions.forEach((a, i) => {
          over(`Link button ${i + 1}`, a.label, L.ctaText);
          if (text(a.type || 'url') === 'url')
            over(`The address of link button ${i + 1}`, a.value, L.ctaUrl);
        });
        break;
      }
      case 'ask': {
        const opts = list(d.options)
          .map(text)
          .filter((o) => o.trim() !== '');
        over('The question', d.prompt, opts.length ? L.body : L.text);
        if (opts.length > L.askOptions)
          add(`A question with answer buttons has at most ${L.askOptions} answers.`);
        opts.forEach((o, i) => over(`Answer ${i + 1}`, o, flbAskOptionMax(opts.length)));
        break;
      }
    }
  }
  return out;
}
