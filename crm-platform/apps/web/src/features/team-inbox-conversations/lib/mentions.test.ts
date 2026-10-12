import { describe, expect, it } from 'vitest';
import { WA_DEVICE_GROUP_MENTIONS_MAX } from '@crm/contracts';
import {
  activeMention,
  displayMentions,
  insertMention,
  jidUser,
  memberLabel,
  prepareMentions,
  type MentionMember,
} from './mentions';

const asha: MentionMember = {
  jid: '919900000001@s.whatsapp.net',
  name: 'Asha Verma',
  phone: '+919900000001',
};
const ravi: MentionMember = {
  jid: '919900000002@s.whatsapp.net',
  name: null,
  phone: '+919900000002',
};
const lid: MentionMember = { jid: '271828182845904@lid', name: null, phone: null };

describe('@mention helpers', () => {
  it('reads the user part of an id, with or without a device suffix', () => {
    expect(jidUser('919900000001@s.whatsapp.net')).toBe('919900000001');
    expect(jidUser('919900000001:12@s.whatsapp.net')).toBe('919900000001');
    expect(jidUser('271828182845904@lid')).toBe('271828182845904');
  });

  it('labels a member by name, else number, else the id', () => {
    expect(memberLabel(asha)).toBe('Asha Verma');
    expect(memberLabel(ravi)).toBe('+919900000002');
    expect(memberLabel(lid)).toBe('271828182845904');
  });

  describe('activeMention', () => {
    it('opens right after an @ at the start or after a space, and carries what was typed', () => {
      expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
      expect(activeMention('hello @As', 9)).toEqual({ start: 6, query: 'As' });
      expect(activeMention('hello @As and more', 9)).toEqual({ start: 6, query: 'As' });
    });
    it('is closed in an email address, without an @, past a space or a new line, and when too long', () => {
      expect(activeMention('mail me@work', 12)).toBeNull();
      expect(activeMention('plain text', 5)).toBeNull();
      expect(activeMention('@Asha Verma', 11)?.query).toBe('Asha Verma');
      expect(activeMention('@Asha\nVerma', 11)).toBeNull();
      // A space after the name closes it: right after a pick the caret sits after `@Asha Verma `.
      expect(activeMention('hi @Asha Verma ', 15)).toBeNull();
      expect(activeMention(`@${'x'.repeat(60)}`, 61)).toBeNull();
    });
  });

  describe('insertMention', () => {
    it('puts @Name and a space in place of what was typed and moves the caret after it', () => {
      const out = insertMention('hi @As', 3, 6, asha);
      expect(out.text).toBe('hi @Asha Verma ');
      expect(out.caret).toBe(out.text.length);
      expect(out.picked).toEqual({ jid: asha.jid, name: 'Asha Verma', token: '@Asha Verma' });
    });
    it('keeps the rest of the text after the caret', () => {
      const out = insertMention('@A please', 0, 2, ravi);
      expect(out.text).toBe('@+919900000002  please');
    });
  });

  describe('prepareMentions', () => {
    it('swaps each picked @Name for @<user> and lists the member', () => {
      const text = 'hi @Asha Verma and @+919900000002 !';
      const out = prepareMentions(text, [
        { jid: asha.jid, name: 'Asha Verma', token: '@Asha Verma' },
        { jid: ravi.jid, name: '+919900000002', token: '@+919900000002' },
      ]);
      expect(out.body).toBe('hi @919900000001 and @919900000002 !');
      expect(out.mentions).toEqual([
        { jid: asha.jid, name: 'Asha Verma' },
        { jid: ravi.jid, name: '+919900000002' },
      ]);
    });
    it('drops a member whose token was deleted or edited, and sends no mentions then', () => {
      const out = prepareMentions('hi Asha', [
        { jid: asha.jid, name: 'Asha Verma', token: '@Asha Verma' },
      ]);
      expect(out).toEqual({ body: 'hi Asha', mentions: [] });
    });
    it('does not touch a longer name that only starts like a picked one', () => {
      const out = prepareMentions('@Anna and @Ann', [
        { jid: '1@s.whatsapp.net', name: 'Ann', token: '@Ann' },
      ]);
      expect(out.body).toBe('@Anna and @1');
    });
    it('swaps the longer token first, and counts one member once', () => {
      const out = prepareMentions('@Ann Lee, @Ann Lee again', [
        { jid: '2@s.whatsapp.net', name: 'Ann Lee', token: '@Ann Lee' },
        { jid: '1@s.whatsapp.net', name: 'Ann', token: '@Ann' },
      ]);
      expect(out.body).toBe('@2, @2 again');
      expect(out.mentions.map((m) => m.jid)).toEqual(['2@s.whatsapp.net']);
    });
    it('handles names with regex characters as plain text', () => {
      const out = prepareMentions('hey @A.(b)+ ok', [
        { jid: '3@s.whatsapp.net', name: 'A.(b)+', token: '@A.(b)+' },
      ]);
      expect(out.body).toBe('hey @3 ok');
    });
    it('sends at most the contract cap', () => {
      const picks = Array.from({ length: WA_DEVICE_GROUP_MENTIONS_MAX + 5 }, (_, i) => ({
        jid: `${1000 + i}@s.whatsapp.net`,
        name: `N${i}x`,
        token: `@N${i}x`,
      }));
      const text = picks.map((p) => p.token).join(' ');
      expect(prepareMentions(text, picks).mentions).toHaveLength(WA_DEVICE_GROUP_MENTIONS_MAX);
    });
  });

  describe('displayMentions', () => {
    it('shows the names of the mentioned members in a stored body', () => {
      expect(
        displayMentions('hi @919900000001, call @271828182845904', [
          { jid: asha.jid, name: 'Asha Verma' },
          { jid: lid.jid, name: 'Ravi' },
        ]),
      ).toBe('hi @Asha Verma, call @Ravi');
    });
    it('leaves the body alone without mentions or names, and never matches a longer number', () => {
      expect(displayMentions('hi @919900000001', undefined)).toBe('hi @919900000001');
      expect(displayMentions('hi @919900000001', [{ jid: asha.jid }])).toBe('hi @919900000001');
      expect(displayMentions('hi @9199000000019', [{ jid: asha.jid, name: 'Asha' }])).toBe(
        'hi @9199000000019',
      );
    });
  });
});
