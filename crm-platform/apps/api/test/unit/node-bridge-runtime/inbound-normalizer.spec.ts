import { describe, expect, it } from 'vitest';
import {
  normalizeMessage,
  visibleText,
  type RawMessage,
} from '../../../src/infra/providers/node-bridge-runtime/inbound-normalizer';

const NOW = new Date('2026-10-05T12:00:00Z');
const ts = (agoSeconds: number) => Math.floor(NOW.getTime() / 1000) - agoSeconds;
const PHONE_JID = '919876543210@s.whatsapp.net';

const msg = (over: Partial<RawMessage> & { message?: RawMessage['message'] } = {}): RawMessage => ({
  key: { id: 'ABC1', remoteJid: PHONE_JID, fromMe: false },
  message: { conversation: 'Hello' },
  messageTimestamp: ts(5),
  pushName: 'Asha',
  ...over,
});

describe('what is dropped (TW-NODE-016 rules 1 to 3, 10)', () => {
  it("only notify is live; append is kept for the business's own messages only", () => {
    expect(normalizeMessage(msg(), 'notify', NOW)).toMatchObject({ kind: 'inbound' });
    expect(normalizeMessage(msg(), 'append', NOW)).toBeNull();
    expect(
      normalizeMessage(
        msg({ key: { id: 'E1', remoteJid: PHONE_JID, fromMe: true } }),
        'append',
        NOW,
      ),
    ).toMatchObject({ kind: 'echo' });
    expect(normalizeMessage(msg(), 'prepend', NOW)).toBeNull();
    expect(normalizeMessage(msg(), 'replace', NOW)).toBeNull();
  });

  it('a replay older than 10 minutes is dropped, one just inside it is kept', () => {
    expect(normalizeMessage(msg({ messageTimestamp: ts(601) }), 'notify', NOW)).toBeNull();
    expect(normalizeMessage(msg({ messageTimestamp: ts(599) }), 'notify', NOW)).not.toBeNull();
  });

  it('reads a timestamp given as a number, a string or a long', () => {
    expect(
      normalizeMessage(msg({ messageTimestamp: String(ts(5)) }), 'notify', NOW),
    ).not.toBeNull();
    expect(
      normalizeMessage(msg({ messageTimestamp: { toNumber: () => ts(5) } }), 'notify', NOW),
    ).not.toBeNull();
    expect(
      normalizeMessage(msg({ messageTimestamp: { toNumber: () => ts(700) } }), 'notify', NOW),
    ).toBeNull();
  });

  it.each(['status@broadcast', '1203@newsletter', '5551@broadcast', ''])(
    'skips the chat %j',
    (jid) => {
      expect(
        normalizeMessage(msg({ key: { id: 'X', remoteJid: jid, fromMe: false } }), 'notify', NOW),
      ).toBeNull();
    },
  );

  it('skips a message with no id, no body, or nothing to show', () => {
    expect(normalizeMessage(msg({ key: { remoteJid: PHONE_JID } }), 'notify', NOW)).toBeNull();
    expect(normalizeMessage(msg({ message: null }), 'notify', NOW)).toBeNull();
    expect(
      normalizeMessage(msg({ message: { protocolMessage: { type: 0 } } }), 'notify', NOW),
    ).toBeNull();
    expect(normalizeMessage(msg({ message: { conversation: '' } }), 'notify', NOW)).toBeNull();
  });
});

describe('visible text priority (rule 5)', () => {
  it('conversation, then extended text, then button and list replies, then the native flow answer', () => {
    expect(visibleText({ conversation: 'a', extendedTextMessage: { text: 'b' } })).toBe('a');
    expect(visibleText({ extendedTextMessage: { text: 'b' } })).toBe('b');
    expect(
      visibleText({
        buttonsResponseMessage: { selectedDisplayText: 'Yes', selectedButtonId: 'id1' },
      }),
    ).toBe('Yes');
    expect(visibleText({ buttonsResponseMessage: { selectedButtonId: 'id1' } })).toBe('id1');
    expect(
      visibleText({
        listResponseMessage: { title: 'Plan A', singleSelectReply: { selectedRowId: 'r1' } },
      }),
    ).toBe('Plan A');
    expect(
      visibleText({ listResponseMessage: { singleSelectReply: { selectedRowId: 'r1' } } }),
    ).toBe('r1');
    expect(visibleText({ templateButtonReplyMessage: { selectedDisplayText: 'Buy' } })).toBe('Buy');
    expect(
      visibleText({
        interactiveResponseMessage: {
          nativeFlowResponseMessage: { paramsJson: '{"display_text":"Book","id":"b1"}' },
        },
      }),
    ).toBe('Book');
    expect(
      visibleText({
        interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"b1"}' } },
      }),
    ).toBe('b1');
    expect(
      visibleText({
        interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: 'not json' } },
      }),
    ).toBeNull();
    expect(visibleText({})).toBeNull();
  });
});

describe('who the chat is (rule 4)', () => {
  const chat = (key: RawMessage['key']) =>
    (
      normalizeMessage(msg({ key: { id: 'K', fromMe: false, ...key } }), 'notify', NOW) as {
        message: { chat: unknown };
      }
    ).message.chat;

  it('a normal chat: the phone is the digits of the chat id', () => {
    expect(chat({ remoteJid: PHONE_JID })).toEqual({
      jid: PHONE_JID,
      phone: '919876543210',
      lid: null,
      isGroup: false,
    });
    expect(chat({ remoteJid: '919876543210:7@s.whatsapp.net' })).toMatchObject({
      phone: '919876543210',
    });
  });
  it('a LID chat with the real phone supplied: the phone wins and the LID is kept so threads can merge', () => {
    expect(
      chat({ remoteJid: '12345678901234@lid', senderPn: '919876543210@s.whatsapp.net' }),
    ).toEqual({
      jid: PHONE_JID,
      phone: '919876543210',
      lid: '12345678901234',
      isGroup: false,
    });
    expect(
      chat({ remoteJid: '1234@lid', participantPn: '919876543210@s.whatsapp.net' }),
    ).toMatchObject({ phone: '919876543210' });
    expect(
      chat({ remoteJid: '1234@lid', remoteJidAlt: '919876543210@s.whatsapp.net' }),
    ).toMatchObject({ phone: '919876543210' });
  });
  it('a LID-only chat has no phone and keeps the raw id', () => {
    expect(chat({ remoteJid: '55512345@lid' })).toEqual({
      jid: '55512345@lid',
      phone: null,
      lid: '55512345',
      isGroup: false,
    });
  });
});

describe('what is in it (rules 6 to 8)', () => {
  const n = (message: RawMessage['message'], over: Partial<RawMessage> = {}) =>
    normalizeMessage(msg({ message, ...over }), 'notify', NOW);

  it('media: kind, type, file name and size; the caption becomes the text', () => {
    expect(
      n({ imageMessage: { mimetype: 'image/jpeg', caption: 'Look', fileLength: 2048 } }),
    ).toMatchObject({
      message: {
        text: 'Look',
        media: { kind: 'image', mimeType: 'image/jpeg', fileName: null, sizeBytes: 2048 },
      },
    });
    expect(
      n({ documentMessage: { mimetype: 'application/pdf', fileName: 'invoice.pdf' } }),
    ).toMatchObject({
      message: { media: { kind: 'document', fileName: 'invoice.pdf' }, text: null },
    });
    expect(n({ documentMessage: { title: 'Brochure' } })).toMatchObject({
      message: { media: { fileName: 'Brochure' } },
    });
    for (const [key, kind] of [
      ['videoMessage', 'video'],
      ['audioMessage', 'audio'],
      ['stickerMessage', 'sticker'],
    ] as const) {
      expect(n({ [key]: { mimetype: 'x/y' } })).toMatchObject({ message: { media: { kind } } });
    }
  });

  it('a location, static or live', () => {
    expect(
      n({
        locationMessage: {
          degreesLatitude: 12.97,
          degreesLongitude: 77.59,
          name: 'Office',
          address: 'MG Road',
        },
      }),
    ).toMatchObject({
      message: {
        location: { latitude: 12.97, longitude: 77.59, name: 'Office', address: 'MG Road' },
      },
    });
    expect(n({ liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2 } })).toMatchObject({
      message: { location: { latitude: 1, longitude: 2, name: null } },
    });
  });

  it('a contact card: the first contact, its name, the first TEL and the whole vCard', () => {
    const vcard =
      'BEGIN:VCARD\nVERSION:3.0\nFN:Ravi Kumar\nTEL;type=CELL;waid=919000000001:+91 90000 00001\nTEL:+91 80000 00002\nEND:VCARD';
    expect(n({ contactMessage: { displayName: 'Ravi', vcard } })).toMatchObject({
      message: { contact: { name: 'Ravi', phone: '+919000000001', vcard } },
    });
    expect(n({ contactsArrayMessage: { contacts: [{ vcard }, { vcard: 'x' }] } })).toMatchObject({
      message: { contact: { name: 'Ravi Kumar', phone: '+919000000001' } },
    });
  });

  it('a reaction is posted alone: the target and the emoji, nothing else', () => {
    expect(
      n({ reactionMessage: { key: { id: 'TARGET1' }, text: '👍' }, conversation: 'ignored' }),
    ).toMatchObject({
      kind: 'inbound',
      message: { reaction: { emoji: '👍', targetMessageId: 'TARGET1' }, text: null, media: null },
    });
  });

  it('forwarded, with its score', () => {
    expect(
      n({
        extendedTextMessage: {
          text: 'fwd',
          contextInfo: { isForwarded: true, forwardingScore: 5 },
        },
      }),
    ).toMatchObject({
      message: { forwarded: { score: 5 } },
    });
    expect(n({ conversation: 'plain' })).toMatchObject({ message: { forwarded: null } });
  });

  it('carries the sender name and the message id', () => {
    expect(n({ conversation: 'hi' })).toMatchObject({
      message: { providerMessageId: 'ABC1', pushName: 'Asha', fromMe: false },
    });
  });
});

describe("the business's own messages (TW-NODE-018)", () => {
  it('typed on the phone: an echo, with the same body rules, never a customer message', () => {
    const r = normalizeMessage(
      msg({ key: { id: 'ME1', remoteJid: PHONE_JID, fromMe: true } }),
      'notify',
      NOW,
    );
    expect(r).toMatchObject({ kind: 'echo', message: { fromMe: true, text: 'Hello' } });
  });
  it('an old one is history, not an echo to sync', () => {
    expect(
      normalizeMessage(
        msg({ key: { id: 'ME2', remoteJid: PHONE_JID, fromMe: true }, messageTimestamp: ts(700) }),
        'append',
        NOW,
      ),
    ).toBeNull();
  });
});

describe('groups (TW-NODE-018 rule 3)', () => {
  const group = (key: Partial<RawMessage['key']>) =>
    normalizeMessage(
      msg({ key: { id: 'G1', remoteJid: '120363000000@g.us', fromMe: false, ...key } }),
      'notify',
      NOW,
    );

  it('are stored only: a group message is never an inbound customer message', () => {
    expect(group({ participant: '919876543210@s.whatsapp.net' })).toMatchObject({
      kind: 'group',
      message: {
        chat: { jid: '120363000000@g.us', isGroup: true, phone: null },
        participant: { phone: '919876543210', name: 'Asha' },
      },
    });
  });
  it('a speaker known only by LID keeps the LID instead of the message being lost', () => {
    expect(group({ participant: '77711122@lid' })).toMatchObject({
      message: { participant: { phone: null, lid: '77711122' } },
    });
    expect(
      group({ participant: '77711122@lid', participantPn: '919876543210@s.whatsapp.net' }),
    ).toMatchObject({
      message: { participant: { phone: '919876543210', lid: '77711122' } },
    });
  });
  it("the business's own group message is still a group message", () => {
    expect(group({ fromMe: true })).toMatchObject({ kind: 'group', message: { fromMe: true } });
  });
});

describe('rich content (wrappers, several contacts, replies, unsupported types)', () => {
  const read = (message: RawMessage['message']) => {
    const n = normalizeMessage(msg({ message }), 'notify', NOW);
    return n && n.kind !== 'group' ? n.message : null;
  };

  it('reads the content inside a disappearing-chat or view-once wrapper', () => {
    expect(read({ ephemeralMessage: { message: { conversation: 'secret' } } })).toMatchObject({
      text: 'secret',
    });
    expect(
      read({
        viewOnceMessageV2: {
          message: { imageMessage: { mimetype: 'image/jpeg', caption: 'once' } },
        },
      }),
    ).toMatchObject({ media: { kind: 'image' }, text: 'once' });
  });

  it('keeps every card of a contacts message with all phones, emails and the company', () => {
    const vcard = (n: string, tel: string) =>
      `BEGIN:VCARD\nFN:${n}\nORG:Acme;\nTEL;type=CELL:${tel}\nEMAIL:${n.toLowerCase()}@x.io\nEND:VCARD`;
    const m = read({
      contactsArrayMessage: {
        contacts: [
          { displayName: 'Ann', vcard: vcard('Ann', '+91 98765 43210') },
          { displayName: 'Bob', vcard: vcard('Bob', '+1 555 0100') },
        ],
      },
    });
    expect(m?.contacts).toEqual([
      { name: 'Ann', phones: ['+919876543210'], emails: ['ann@x.io'], org: 'Acme' },
      { name: 'Bob', phones: ['+15550100'], emails: ['bob@x.io'], org: 'Acme' },
    ]);
  });

  it('carries the id of the message being replied to', () => {
    expect(
      read({ extendedTextMessage: { text: 'yes', contextInfo: { stanzaId: 'WAMID.Q1' } } }),
    ).toMatchObject({ replyToProviderMessageId: 'WAMID.Q1' });
  });

  it('keeps a poll, a product or an order as a placeholder instead of dropping it', () => {
    expect(read({ pollCreationMessageV3: { name: 'Lunch?' } })).toMatchObject({
      unsupported: { rawType: 'pollCreationMessageV3', label: 'Poll' },
    });
    expect(read({ orderMessage: { itemCount: 2 } })).toMatchObject({
      unsupported: { label: 'Order' },
    });
  });

  it('still drops an event with nothing to show', () => {
    expect(read({ senderKeyDistributionMessage: {} })).toBeNull();
  });
});
