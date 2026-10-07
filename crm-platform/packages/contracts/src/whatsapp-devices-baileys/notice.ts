/**
 * The risk notice a person accepts before a personal WhatsApp number is added or paired (docs/specs/personal-whatsapp-connect.md
 * section 6). This file is the single source of the CANONICAL ENGLISH TEXT: the API hashes it (SHA-256 of
 * `personalWaNoticeCanonicalText()`) into every acknowledgement row, and the web shows it (and its Arabic translation, keyed by
 * `PERSONAL_WA_NOTICE_VERSION`). The wording is a DRAFT for counsel (spec decision D1): changing any character here means a new
 * version string, which asks everybody again at their next create or pairing.
 *
 * Honest-copy rules (spec 6.4): never "safe", "official", "protected" or "guaranteed" next to this feature.
 */

/** Bump on ANY change to the items or notes below. Format `YYYY-MM-DD.N`. */
export const PERSONAL_WA_NOTICE_VERSION = '2026-10-07.1';

export const PERSONAL_WA_NOTICE_ITEM_IDS = [
  'not_approved_ban_risk',
  'own_number_expected_contacts',
  'shared_inbox_disclosure',
] as const;
export type PersonalWaNoticeItemId = (typeof PERSONAL_WA_NOTICE_ITEM_IDS)[number];

/** The three statements, each ticked on its own (no pre-ticked box, no "agree to all"). */
export const PERSONAL_WA_NOTICE_ITEMS: ReadonlyArray<{ id: PersonalWaNoticeItemId; text: string }> =
  [
    {
      id: 'not_approved_ban_risk',
      text: "I understand this connects my WhatsApp the way WhatsApp Web does. It is not an approved way to automate WhatsApp and it goes against WhatsApp's terms. WhatsApp can restrict or permanently ban this number at any time, including for normal use, and we cannot prevent it or get the number back.",
    },
    {
      id: 'own_number_expected_contacts',
      text: "I will only connect a number I own or have the owner's permission to connect, and I can afford to lose it. I will only message people who expect to hear from me.",
    },
    {
      id: 'shared_inbox_disclosure',
      text: "I understand that from the moment it is linked, every private chat on this number (not only business chats) appears in this workspace's shared inbox for members who can read the inbox, and messages I type on my phone are copied there too.",
    },
  ];

/** Plain-language notes shown next to the list (not checkboxes). */
export const PERSONAL_WA_NOTICE_NOTES: ReadonlyArray<{ id: string; text: string }> = [
  {
    id: 'official_route_lower_risk',
    text: 'The official WhatsApp Business route is the lower-risk one for serious or long-term use.',
  },
  {
    id: 'warm_up',
    text: 'Warm up the number slowly and keep volumes low.',
  },
  {
    id: 'no_ban_support',
    text: 'A restricted or banned number is not covered by support: we do not investigate it, restore it or refund it.',
  },
  {
    id: 'shared_addresses',
    text: "In this pilot, numbers connect from our servers' shared addresses (no proxy), so a restriction on one number can be linked to others.",
  },
  {
    id: 'disconnect_keeps_chats',
    text: 'Disconnecting here removes the link and the saved session but does not delete the chats from the inbox.',
  },
];

/** What a pairing code is for, shown next to every code (spec 6.4). */
export const PERSONAL_WA_PAIRING_CODE_WARNING =
  'Only enter this code on the phone of the number you are connecting. Never share it with anyone else.';

/**
 * The exact text a version covers, as one string: the version line, the items and the notes, in order. Its SHA-256 is stored with
 * every acknowledgement, so the record proves which wording was shown.
 */
export function personalWaNoticeCanonicalText(): string {
  return [
    `version: ${PERSONAL_WA_NOTICE_VERSION}`,
    ...PERSONAL_WA_NOTICE_ITEMS.map((i, n) => `${n + 1}. ${i.text}`),
    ...PERSONAL_WA_NOTICE_NOTES.map((n) => `- ${n.text}`),
  ].join('\n');
}
