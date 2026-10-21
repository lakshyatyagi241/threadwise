import { describe, expect, it } from 'vitest';
import {
  BOOKING_REMINDER_PLACEHOLDERS,
  BOOKING_TIMED_STEPS_MAX,
  REMINDER_PACK_KEYS,
  reminderPackSchema,
} from '@crm/contracts';
import {
  PACKS,
  PACKS_VERSION,
  PACK_BUTTONS,
  libraryKeyOf,
  waTemplateNameOf,
  type PackData,
} from '../../../src/modules/appointments-booking/reminder-packs.data';
import {
  WA_EXAMPLES,
  toWhatsappBody,
  unknownPlaceholders,
  variablesOf,
} from '../../../src/modules/appointments-booking/appointment-template.rules';
import {
  actionFor,
  toApiPack,
} from '../../../src/modules/appointments-booking/reminder-packs.service';

const LANGS = ['en', 'hi'] as const;
/** Meta's limits for a template: body 1024, a quick-reply button 25, a name of lowercase letters, digits and underscores. */
const META_BODY_MAX = 1024;
const META_BUTTON_MAX = 25;
const META_NAME = /^[a-z0-9_]{1,512}$/;
const EMAIL_ONLY = ['host_name', 'host_phone', 'map_link'];

const pack = (key: string): PackData => PACKS.find((p) => p.key === key)!;
const step = (key: string, s: string) => pack(key).steps.find((x) => x.stepKind === s);

describe('the seven packs', () => {
  it('are exactly the seven, in the contract, each once', () => {
    expect(PACKS.map((p) => p.key).sort()).toEqual([...REMINDER_PACK_KEYS].sort());
    expect(new Set(PACKS.map((p) => p.key)).size).toBe(7);
  });

  it('are valid on the wire', () => {
    for (const p of PACKS) expect(() => reminderPackSchema.parse(toApiPack(p))).not.toThrow();
    expect(PACKS_VERSION).toBeGreaterThan(0);
  });

  it('keep to at most five steps with a time, plus the event steps', () => {
    for (const p of PACKS) {
      expect(p.steps.filter((s) => s.kind !== 'event').length).toBeLessThanOrEqual(
        BOOKING_TIMED_STEPS_MAX,
      );
      expect(new Set(p.steps.map((s) => s.stepKind)).size).toBe(p.steps.length);
    }
  });

  it('match what the owner asked for, step by step', () => {
    const on = (k: string, s: string) => step(k, s)?.isActive;
    for (const k of ['clinic', 'dental']) {
      expect(
        ['confirmation', 'reminder_24h', 'reminder_2h', 'no_show'].map((s) => on(k, s)),
      ).toEqual([true, true, true, true]);
      expect(on(k, 'after_visit')).toBe(false);
      expect(on(k, 'rebook')).toBe(false);
    }
    expect(step('dental', 'rebook')!.offsetMinutes).toBe(180 * 1440);
    expect(step('salon_spa', 'rebook')!.offsetMinutes).toBe(35 * 1440);
    expect(on('salon_spa', 'rebook')).toBe(false);
    expect(on('salon_spa', 'after_visit')).toBe(true);
    expect(on('property_visit', 'no_show')).toBe(true);
    expect(on('property_visit', 'after_visit')).toBe(true);
    const fifteen = step('sales_meeting', 'reminder_15m')!;
    expect(fifteen.onlineOnly).toBe(true);
    expect(fifteen.offsetMinutes).toBe(15);
    expect(on('sales_meeting', 'after_visit')).toBe(true);
    expect(on('sales_meeting', 'no_show')).toBe(true);
    for (const k of ['fitness_wellness', 'home_auto_service']) {
      expect(on(k, 'no_show')).toBe(true);
      expect(on(k, 'after_visit')).toBe(true);
      expect(on(k, 'reminder_2h')).toBe(true);
    }
    // buttons on the 24 hour reminder of every pack, and only there
    for (const p of PACKS) {
      expect(p.steps.filter((s) => s.buttons).map((s) => s.stepKind)).toEqual(['reminder_24h']);
    }
  });

  it('send the after-visit and rebook messages as marketing and everything else as utility', () => {
    for (const p of PACKS) {
      for (const s of p.steps) {
        const marketing = s.stepKind === 'after_visit' || s.stepKind === 'rebook';
        expect(s.category).toBe(marketing ? 'MARKETING' : 'UTILITY');
      }
    }
  });

  it('only a medical practice hides the service, and never names it', () => {
    for (const p of PACKS) {
      const medical = p.key === 'clinic' || p.key === 'dental';
      expect(p.serviceLabel !== null).toBe(medical);
      if (medical) expect(p.serviceLabel).toEqual({ en: 'appointment', hi: 'अपॉइंटमेंट' });
    }
    for (const k of ['clinic', 'dental']) {
      for (const s of pack(k).steps) {
        for (const l of LANGS) {
          const t = s.text[l];
          for (const text of [t.subject, t.email, t.wa]) {
            expect(text).not.toMatch(/\{\{\s*title\s*\}\}/);
            expect(text).not.toMatch(/doctor|dentist|treatment|diagnos|prescription|surgery|therapy/i);
          }
        }
      }
    }
  });
});

describe('every message', () => {
  const all = PACKS.flatMap((p) =>
    p.steps.flatMap((s) => LANGS.map((l) => ({ p, s, l, t: s.text[l] }))),
  );

  it('exists in English and Hindi and is not empty', () => {
    expect(all.length).toBe(PACKS.reduce((n, p) => n + p.steps.length, 0) * 2);
    for (const { t } of all) {
      expect(t.subject.trim()).not.toBe('');
      expect(t.email.trim()).not.toBe('');
      expect(t.wa.trim()).not.toBe('');
    }
    for (const { l, t } of all) {
      expect(/[ऀ-ॿ]/.test(t.wa)).toBe(l === 'hi');
    }
  });

  it('uses only placeholders the booking messages know', () => {
    for (const { p, s, l, t } of all) {
      const where = `${p.key}/${s.stepKind}/${l}`;
      expect(unknownPlaceholders(`${t.subject} ${t.email}`), where).toEqual([]);
      expect(unknownPlaceholders(t.wa), where).toEqual([]);
      for (const v of variablesOf(t.subject, t.email, t.wa)) {
        expect(BOOKING_REMINDER_PLACEHOLDERS as readonly string[], where).toContain(v);
      }
    }
  });

  it('is a valid WhatsApp body: the fixed variable order, a word at both ends, Meta length limits, an example for each variable', () => {
    for (const { p, s, l, t } of all) {
      const where = `${p.key}/${s.stepKind}/${l}`;
      const wa = toWhatsappBody(t.wa);
      expect(wa.ok, where).toBe(true);
      if (!wa.ok) continue;
      expect(wa.body.length, where).toBeLessThanOrEqual(META_BODY_MAX);
      const nums = [...wa.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(new Set(nums).size, where).toBe(wa.variables.length);
      expect(Math.max(...nums, 0), where).toBe(wa.variables.length);
      // Meta refuses a variable at the very start or end of the body, and two variables with nothing between them
      expect(wa.body.trimStart().startsWith('{{'), where).toBe(false);
      expect(wa.body.trimEnd().endsWith('}}'), where).toBe(false);
      expect(wa.body, where).not.toMatch(/\}\}\s*\{\{/);
      expect(wa.body, where).not.toMatch(/\n|\t| {4}/);
      for (const slot of wa.variableMap.body) {
        expect(slot.example, where).toBe(WA_EXAMPLES[slot.key]);
        expect(slot.example.length).toBeGreaterThan(0);
      }
      expect(
        variablesOf(t.wa).some((v) => EMAIL_ONLY.includes(v)),
        where,
      ).toBe(false);
    }
  });

  it("puts the quick-reply buttons within Meta's limits (three, 25 characters each)", () => {
    for (const l of LANGS) {
      expect(PACK_BUTTONS[l]).toHaveLength(3);
      for (const b of PACK_BUTTONS[l]) {
        expect(b.length).toBeLessThanOrEqual(META_BUTTON_MAX);
        expect(b.trim()).toBe(b);
      }
    }
  });

  it('has a stable template name appt_<pack>_<step>_<lang>, valid for Meta, unique', () => {
    const names = new Set<string>();
    for (const { p, s, l } of all) {
      const name = waTemplateNameOf(p.key, s.stepKind, l);
      expect(name).toBe(`appt_${p.key}_${s.stepKind}_${l}`);
      expect(name).toMatch(META_NAME);
      expect(names.has(name)).toBe(false);
      names.add(name);
    }
    expect(libraryKeyOf('clinic', 'reminder_24h')).toBe('pack:clinic:reminder_24h');
  });

  it('gives the sales confirmation the join link and the property confirmation the address, a map and the agent (email)', () => {
    expect(step('sales_meeting', 'confirmation')!.text.en.email).toContain('{{join_link}}');
    expect(step('sales_meeting', 'confirmation')!.text.en.wa).toContain('{{join_link}}');
    expect(step('sales_meeting', 'reminder_15m')!.text.en.wa).toContain('{{join_link}}');
    const prop = step('property_visit', 'confirmation')!.text.en;
    expect(prop.email).toMatch(/\{\{map_link\}\}[\s\S]*\{\{host_name\}\}[\s\S]*\{\{host_phone\}\}/);
    expect(prop.wa).toContain('{{location}}');
    expect(step('property_visit', 'reminder_2h')!.text.en.wa).toContain('{{location}}');
    expect(step('property_visit', 'reminder_2h')!.text.en.email).toContain('{{host_phone}}');
  });
});

describe('what applying a pack does to a step the service already has', () => {
  const p = pack('clinic');
  const s = step('clinic', 'reminder_24h')!;
  it('adds a step it does not have', () => {
    expect(actionFor(undefined, p, s)).toBe('add');
  });
  it('leaves a step that already is this pack at this version and time', () => {
    expect(
      actionFor({ packKey: 'clinic', packVersion: PACKS_VERSION, offsetMinutes: 1440 }, p, s),
    ).toBe('unchanged');
  });
  it("replaces (after a confirm) the owner's own step, another pack's step, an older version and a moved time", () => {
    expect(actionFor({ packKey: null, packVersion: null, offsetMinutes: 1440 }, p, s)).toBe('replace');
    expect(
      actionFor({ packKey: 'dental', packVersion: PACKS_VERSION, offsetMinutes: 1440 }, p, s),
    ).toBe('replace');
    expect(
      actionFor({ packKey: 'clinic', packVersion: PACKS_VERSION - 1, offsetMinutes: 1440 }, p, s),
    ).toBe('replace');
    expect(
      actionFor({ packKey: 'clinic', packVersion: PACKS_VERSION, offsetMinutes: 1000 }, p, s),
    ).toBe('replace');
  });
});
