import { describe, expect, it } from 'vitest';
import {
  ambiguousNouns,
  buildPlan,
  localizeText,
  placeholdersIntact,
  safeOverrides,
  type NounDefaults,
  type NounOverrides,
} from './localize';

const EN: NounDefaults = {
  contact: { one: 'Contact', other: 'Contacts' },
  appointment: { one: 'Appointment', other: 'Appointments' },
  deal: { one: 'Deal', other: 'Deals' },
  meeting: { one: 'Meeting', other: 'Meetings' },
};
const PATIENT: NounOverrides = { contact: { one: 'Patient', other: 'Patients' } };

const run = (text: string, over: NounOverrides, locale = 'en', defaults: NounDefaults = EN) =>
  localizeText(text, buildPlan(locale, defaults, over));

describe('localizeText (English)', () => {
  it('keeps the case of the product word: title, sentence and lower', () => {
    expect(run('Add Contact', PATIENT)).toBe('Add Patient');
    expect(run('Contacts', PATIENT)).toBe('Patients');
    expect(run('Search contacts', PATIENT)).toBe('Search patients');
    expect(run('No contacts yet', PATIENT)).toBe('No patients yet');
    expect(run('Create Contacts', PATIENT)).toBe('Create Patients');
    expect(run('CONTACTS', PATIENT)).toBe('PATIENTS');
  });

  it('uses the plural form for the plural word and the singular for the singular', () => {
    expect(run('Delete this contact?', PATIENT)).toBe('Delete this patient?');
    expect(run('Delete selected contacts?', PATIENT)).toBe('Delete selected patients?');
    expect(run('{count, plural, one {# contact} other {# contacts}} selected', PATIENT)).toBe(
      '{count, plural, one {# patient} other {# patients}} selected',
    );
  });

  it('does not touch longer words or other words', () => {
    expect(run('Never contacted', PATIENT)).toBe('Never contacted');
    expect(run('Contact-less checkout', PATIENT)).toBe('Patient-less checkout');
    expect(run('Subcontacts and noncontact', PATIENT)).toBe('Subcontacts and noncontact');
    expect(run('Companies', PATIENT)).toBe('Companies');
  });

  it('follows the new word for "a" / "an" (English only)', () => {
    const visit: NounOverrides = { appointment: { one: 'Visit', other: 'Visits' } };
    expect(run('Create an appointment', visit)).toBe('Create a visit');
    expect(run('An appointment was booked', visit)).toBe('A visit was booked');
    const exam: NounOverrides = { contact: { one: 'Employee', other: 'Employees' } };
    expect(run('Add a contact', exam)).toBe('Add an employee');
    // not an article: "a" inside another word, or the article of something else
    expect(run('Data contact', PATIENT)).toBe('Data patient');
  });

  it('renames several nouns in one pass and never re-renames the result', () => {
    const over: NounOverrides = {
      contact: { one: 'Deal owner', other: 'Deal owners' },
      deal: { one: 'Admission', other: 'Admissions' },
      appointment: { one: 'Visit', other: 'Visits' },
      meeting: { one: 'Consult', other: 'Consults' },
    };
    expect(run('Add a contact to this deal for the meeting and the appointment', over)).toBe(
      'Add a deal owner to this admission for the consult and the visit',
    );
  });

  it('keeps an acronym or a brand as typed, and lower-cases an ordinary capitalised phrase mid-sentence', () => {
    expect(run('Search contacts', { contact: { one: 'VIP', other: 'VIPs' } })).toBe('Search VIPs');
    expect(run('Search contacts', { contact: { one: 'iPad user', other: 'iPad users' } })).toBe(
      'Search iPad users',
    );
    expect(
      run('Search contacts', {
        contact: { one: 'Real Estate Client', other: 'Real Estate Clients' },
      }),
    ).toBe('Search real estate clients');
  });

  it('leaves ICU arguments and rich-text tags alone, even when they spell the product word', () => {
    expect(run('Hello {contact}, your contact is <b>contact</b>', PATIENT)).toBe(
      'Hello {contact}, your patient is <b>patient</b>',
    );
    expect(run('{contacts} contacts', PATIENT)).toBe('{contacts} patients');
    expect(run('<contact>x</contact> contact', PATIENT)).toBe('<contact>x</contact> patient');
  });

  it('returns the very same string when nothing matches or nothing is overridden', () => {
    const text = 'Inbox and tasks';
    expect(run(text, PATIENT)).toBe(text);
    expect(buildPlan('en', EN, {})).toBeNull();
    expect(localizeText('Add Contact', null)).toBe('Add Contact');
    expect(localizeText('', buildPlan('en', EN, PATIENT))).toBe('');
  });
});

describe('localizeText (other languages)', () => {
  const ES: NounDefaults = {
    contact: { one: 'Contacto', other: 'Contactos' },
    appointment: { one: 'Cita', other: 'Citas' },
    deal: { one: 'Negocio', other: 'Negocios' },
    meeting: { one: 'Reunión', other: 'Reuniones' },
  };
  const JA: NounDefaults = {
    contact: { one: '連絡先', other: '連絡先' },
    appointment: { one: '予約', other: '予約' },
    deal: { one: '案件', other: '案件' },
    meeting: { one: 'ミーティング', other: 'ミーティング' },
  };
  const AR: NounDefaults = {
    contact: { one: 'جهة اتصال', other: 'جهات الاتصال' },
    appointment: { one: 'موعد', other: 'مواعيد' },
    deal: { one: 'صفقة', other: 'صفقات' },
    meeting: { one: 'اجتماع', other: 'اجتماعات' },
  };
  const PL: NounDefaults = {
    contact: { one: 'Kontakt', other: 'Kontakty' },
    appointment: { one: 'Spotkanie', other: 'Spotkania' },
    deal: { one: 'Transakcja', other: 'Transakcje' },
    meeting: { one: 'Spotkanie', other: 'Spotkania' },
  };

  it('Spanish: whole words only, with the case of the original and no agreement', () => {
    const over: NounOverrides = { contact: { one: 'Paciente', other: 'Pacientes' } };
    expect(run('Añadir contacto', over, 'es', ES)).toBe('Añadir paciente');
    expect(run('Contactos', over, 'es', ES)).toBe('Pacientes');
    // no gender agreement: "el contacto" -> "el paciente" works by luck; "la cita" is not touched by this override
    expect(run('Conservar el contacto', over, 'es', ES)).toBe('Conservar el paciente');
    expect(run('Cancelar la cita', over, 'es', ES)).toBe('Cancelar la cita');
  });

  it('Japanese: no spaces between words, so the word is matched inside the run of text', () => {
    const over: NounOverrides = { contact: { one: '患者', other: '患者' } };
    expect(run('連絡先を追加', over, 'ja', JA)).toBe('患者を追加');
    expect(run('連絡先', over, 'ja', JA)).toBe('患者');
  });

  it('Arabic: keeps the glued prefix (al-, wa-, bi-, li-)', () => {
    const over: NounOverrides = { appointment: { one: 'زيارة', other: 'زيارات' } };
    expect(run('المواعيد', over, 'ar', AR)).toBe('الزيارات');
    expect(run('تم إلغاء الموعد.', over, 'ar', AR)).toBe('تم إلغاء الزيارة.');
    expect(run('بالمواعيد', over, 'ar', AR)).toBe('بالزيارات');
    // a different noun's word is not touched
    expect(run('الاجتماعات', over, 'ar', AR)).toBe('الاجتماعات');
  });

  it('Polish: a word that means both appointment and meeting is never renamed (it would rename both)', () => {
    expect([...ambiguousNouns(PL, 'pl')].sort()).toEqual(['appointment', 'meeting']);
    const over: NounOverrides = { appointment: { one: 'Wizyta', other: 'Wizyty' } };
    expect(buildPlan('pl', PL, over)).toBeNull();
    expect(run('Nowe spotkanie', over, 'pl', PL)).toBe('Nowe spotkanie');
    // an unambiguous noun still works
    expect(run('Dodaj kontakt', { contact: { one: 'Pacjent', other: 'Pacjenci' } }, 'pl', PL)).toBe(
      'Dodaj pacjent',
    );
  });

  it('a form the language inflects differently is not recognised and stays as it was', () => {
    const DE: NounDefaults = {
      ...EN,
      contact: { one: 'Kontakt', other: 'Kontakte' },
    };
    const over: NounOverrides = { contact: { one: 'Patient', other: 'Patienten' } };
    expect(run('Kontakt hinzufügen', over, 'de', DE)).toBe('Patient hinzufügen');
    expect(run('Mit dem Kontakten', over, 'de', DE)).toBe('Mit dem Kontakten');
  });
});

describe('safeOverrides: nothing unsafe reaches an ICU message', () => {
  it('keeps valid words and drops the rest', () => {
    expect(
      safeOverrides({
        contact: { one: 'Patient', other: 'Patients' },
        deal: { one: '{x}', other: 'Deals' },
        meeting: { one: 'Call' },
        appointment: 'Visit',
        task: { one: 'Job', other: 'Jobs' },
      }),
    ).toEqual({ contact: { one: 'Patient', other: 'Patients' } });
    expect(safeOverrides(null)).toEqual({});
    expect(safeOverrides('x')).toEqual({});
  });
});

describe('placeholdersIntact', () => {
  it('flags a rewrite that changed an argument or a tag', () => {
    expect(placeholdersIntact('Hello {name}', 'Hello {name}')).toBe(true);
    expect(placeholdersIntact('Hello {name}', 'Hello {nom}')).toBe(false);
    expect(placeholdersIntact('<b>x</b>', '<i>x</i>')).toBe(false);
    expect(placeholdersIntact('{a} {b}', '{a}')).toBe(false);
    expect(placeholdersIntact('one {x}', 'one {x')).toBe(false);
  });
});
