import { TCHAT_MENTION_SOURCE } from '@crm/contracts';

/** A message body split into plain text and mention tokens. The text is rendered as text, never as markup. */
export type BodyPart =
  { type: 'text'; text: string } | { type: 'mention'; name: string; userId: string };

/**
 * `hello @[Sam](uuid) see you` -> text, mention, text. The name shown is the one the token carries (the server only trusts the
 * id), so `isMe` compares ids, not names.
 */
export function parseBody(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of body.matchAll(new RegExp(TCHAT_MENTION_SOURCE, 'g'))) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ type: 'text', text: body.slice(last, at) });
    parts.push({ type: 'mention', name: m[1]!, userId: m[2]!.toLowerCase() });
    last = at + m[0].length;
  }
  if (last < body.length) parts.push({ type: 'text', text: body.slice(last) });
  return parts;
}

/** The text of a message with its tokens shown as `@Name`: for a reply banner, a search hit or a notification. */
export function plainBody(body: string): string {
  return parseBody(body)
    .map((p) => (p.type === 'text' ? p.text : `@${p.name}`))
    .join('');
}
