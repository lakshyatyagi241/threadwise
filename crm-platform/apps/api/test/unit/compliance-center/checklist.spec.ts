import { describe, expect, it } from 'vitest';
import {
  BASELINE_ITEM_IDS,
  CHECKLIST_DETAIL_KEYS,
  COMPLIANCE_DEFAULTS,
  COMPLIANCE_REGIMES,
  PROFILE_ITEM_IDS,
  type ComplianceSettingsValues,
} from '@crm/contracts';
import {
  buildChecklist,
  type ChecklistFacts,
} from '../../../src/modules/compliance-center/compliance-checklist.rules';
import {
  isKnownTimezone,
  settingsDelta,
  settingsProblems,
} from '../../../src/modules/compliance-center/compliance-settings.service';

type FactsPatch = Omit<Partial<ChecklistFacts>, 'settings'> & {
  settings?: Partial<ComplianceSettingsValues>;
};

const facts = (patch: FactsPatch = {}): ChecklistFacts => ({
  consent: { detectionEnabled: true, requireConsentForMarketing: true },
  notices: { enabledCount: 0, workspaceLocales: [] },
  requests: { slaDays: 30, open: 0, overdue: 0 },
  recording: { enabled: false, retentionDays: 90 },
  subprocessors: { active: 0, withLocation: 0 },
  ...patch,
  settings: { ...COMPLIANCE_DEFAULTS, ...patch.settings },
});

const row = (c: ReturnType<typeof buildChecklist>, id: string) => c.items.find((i) => i.id === id)!;

describe('the baseline checklist (every workspace)', () => {
  it('lists every baseline point once, in order, with nothing from a profile', () => {
    const c = buildChecklist(facts(), []);
    expect(c.items.map((i) => i.id)).toEqual([...BASELINE_ITEM_IDS]);
    expect(c.items.every((i) => i.scope === 'baseline' && i.regimes.length === 0)).toBe(true);
    expect(c.summary.built + c.summary.partial + c.summary.open).toBe(c.items.length);
  });

  it('an empty workspace starts mostly open and is never told it is done', () => {
    const c = buildChecklist(facts(), []);
    expect(row(c, 'notices').status).toBe('open');
    expect(row(c, 'subprocessors').status).toBe('open');
    expect(row(c, 'children').status).toBe('open');
    expect(row(c, 'contact_links').status).toBe('open');
    expect(row(c, 'security').status).toBe('partial');
    expect(row(c, 'retention').status).toBe('partial');
    expect(c.summary.open).toBeGreaterThan(0);
  });

  it('consent: withdrawal alone is partial, opt-in makes it built, detection off is open', () => {
    expect(
      row(
        buildChecklist(
          facts({ consent: { detectionEnabled: false, requireConsentForMarketing: true } }),
          [],
        ),
        'consent_withdrawal',
      ).status,
    ).toBe('open');
    expect(
      row(
        buildChecklist(
          facts({ consent: { detectionEnabled: true, requireConsentForMarketing: false } }),
          [],
        ),
        'consent_withdrawal',
      ).status,
    ).toBe('partial');
    expect(row(buildChecklist(facts(), []), 'consent_withdrawal').status).toBe('built');
  });

  it('notices: a workspace default is built, other consent lines are a start, none is open', () => {
    expect(
      row(
        buildChecklist(facts({ notices: { enabledCount: 2, workspaceLocales: ['en'] } }), []),
        'notices',
      ).status,
    ).toBe('built');
    expect(
      row(
        buildChecklist(facts({ notices: { enabledCount: 1, workspaceLocales: [] } }), []),
        'notices',
      ).status,
    ).toBe('partial');
    expect(row(buildChecklist(facts(), []), 'notices').status).toBe('open');
  });

  it('rights: overdue requests or no contact make it partial, a contact and no delay make it built', () => {
    const contact = { dpo: { name: 'Sam', email: 'p@x.test', phone: '', address: '' } };
    expect(
      row(
        buildChecklist(
          facts({ settings: contact, requests: { slaDays: 30, open: 3, overdue: 1 } }),
          [],
        ),
        'rights',
      ),
    ).toMatchObject({ status: 'partial', detail: 'overdue', params: { overdue: 1 } });
    expect(row(buildChecklist(facts(), []), 'rights')).toMatchObject({
      status: 'partial',
      detail: 'noContact',
    });
    expect(row(buildChecklist(facts({ settings: contact }), []), 'rights').status).toBe('built');
  });

  it('children: minors without the parental flag is partial', () => {
    expect(
      row(
        buildChecklist(facts({ settings: { childrenPolicy: 'may_include_minors' } }), []),
        'children',
      ).status,
    ).toBe('partial');
    expect(
      row(
        buildChecklist(
          facts({
            settings: { childrenPolicy: 'may_include_minors', parentalConsentRequired: true },
          }),
          [],
        ),
        'children',
      ).status,
    ).toBe('built');
    expect(
      row(buildChecklist(facts({ settings: { childrenPolicy: 'no_minors' } }), []), 'children')
        .status,
    ).toBe('built');
  });

  it('links: both links and a reachable contact is built, one of them partial', () => {
    const full = {
      privacyUrl: 'https://x.test/p',
      termsUrl: 'https://x.test/t',
      dpo: { name: '', email: 'p@x.test', phone: '', address: '' },
    };
    expect(row(buildChecklist(facts({ settings: full }), []), 'contact_links').status).toBe(
      'built',
    );
    expect(
      row(
        buildChecklist(facts({ settings: { privacyUrl: 'https://x.test/p' } }), []),
        'contact_links',
      ).status,
    ).toBe('partial');
  });

  it('never uses the word compliant in a detail key', () => {
    const c = buildChecklist(facts(), ['gdpr_eu', 'dpdp_in', 'tcpa_us', 'ccpa_us']);
    for (const i of c.items) expect(i.detail).not.toMatch(/compliant/i);
  });
});

describe('profile rows', () => {
  it('adds only what the switched-on profiles ask for, and names the profiles', () => {
    const c = buildChecklist(facts(), ['dpdp_in']);
    const profile = c.items.filter((i) => i.scope === 'profile').map((i) => i.id);
    expect(profile).toEqual([
      'grievance_officer',
      'notice_languages',
      'parental_flag',
      'request_days',
      'marketing_opt_in',
    ]);
    expect(row(c, 'grievance_officer').regimes).toEqual(['dpdp_in']);
    for (const id of profile) expect(PROFILE_ITEM_IDS).toContain(id);
  });

  it('DPDP: needs the officer, English and the second language, and the parental flag for minors', () => {
    const base = {
      secondaryNoticeLocale: 'hi',
      grievanceOfficer: { name: 'Asha', email: 'g@x.test', phone: '', address: '' },
      childrenPolicy: 'may_include_minors' as const,
    };
    const open = buildChecklist(facts({ settings: base }), ['dpdp_in']);
    expect(row(open, 'grievance_officer').status).toBe('built');
    expect(row(open, 'notice_languages').status).toBe('open');
    expect(row(open, 'parental_flag').status).toBe('partial');
    const done = buildChecklist(
      facts({
        settings: { ...base, parentalConsentRequired: true },
        notices: { enabledCount: 2, workspaceLocales: ['en', 'hi'] },
      }),
      ['dpdp_in'],
    );
    expect(row(done, 'notice_languages').status).toBe('built');
    expect(row(done, 'parental_flag').status).toBe('built');
    const half = buildChecklist(
      facts({ settings: base, notices: { enabledCount: 1, workspaceLocales: ['en'] } }),
      ['dpdp_in'],
    );
    expect(row(half, 'notice_languages')).toMatchObject({
      status: 'partial',
      detail: 'secondMissing',
    });
  });

  it('CCPA: the switch without the notice link is partial', () => {
    expect(row(buildChecklist(facts(), ['ccpa_us']), 'opt_out_notice').status).toBe('open');
    expect(
      row(
        buildChecklist(facts({ settings: { offerSaleShareOptOut: true } }), ['ccpa_us']),
        'opt_out_notice',
      ).status,
    ).toBe('partial');
    expect(
      row(
        buildChecklist(
          facts({ settings: { offerSaleShareOptOut: true, optOutNoticeUrl: 'https://x.test/o' } }),
          ['ccpa_us'],
        ),
        'opt_out_notice',
      ).status,
    ).toBe('built');
  });

  it('answer time: the strictest profile is compared with the days set for requests', () => {
    const c = buildChecklist(facts({ requests: { slaDays: 30, open: 0, overdue: 0 } }), [
      'gdpr_eu',
      'lgpd_br',
    ]);
    expect(row(c, 'request_days')).toMatchObject({
      status: 'partial',
      detail: 'tooLong',
      params: { days: 15, sla: 30 },
    });
    expect(row(c, 'request_days').regimes.sort()).toEqual(['gdpr_eu', 'lgpd_br']);
    const ok = buildChecklist(facts({ requests: { slaDays: 15, open: 0, overdue: 0 } }), [
      'gdpr_eu',
      'lgpd_br',
    ]);
    expect(row(ok, 'request_days').status).toBe('built');
  });

  it('quiet hours and windows are stored, never reported as enforced', () => {
    const on = buildChecklist(
      facts({
        settings: {
          quietHours: { enabled: true, start: '21:00', end: '09:00' },
          callingWindow: { ...COMPLIANCE_DEFAULTS.callingWindow, enabled: true },
          dndRegistry: 'trai_ndnc',
        },
      }),
      ['trai_in'],
    );
    expect(row(on, 'quiet_hours').status).toBe('built');
    expect(row(on, 'calling_window').status).toBe('built');
    expect(row(on, 'dnd_registry').status).toBe('partial');
    expect(row(on, 'windows_enforcement')).toMatchObject({
      status: 'partial',
      detail: 'notEnforced',
    });
    const off = buildChecklist(facts(), ['trai_in']);
    expect(off.items.find((i) => i.id === 'windows_enforcement')).toBeUndefined();
    expect(row(off, 'quiet_hours').status).toBe('open');
  });

  it('officer rows: both name and email is built, one is partial, none is open', () => {
    const mk = (dpo: { name: string; email: string }) =>
      row(
        buildChecklist(facts({ settings: { dpo: { ...dpo, phone: '', address: '' } } }), [
          'pdpa_sg',
        ]),
        'dpo_contact',
      ).status;
    expect(mk({ name: 'A', email: 'a@x.test' })).toBe('built');
    expect(mk({ name: 'A', email: '' })).toBe('partial');
    expect(mk({ name: '', email: '' })).toBe('open');
  });

  it('sub-processor locations: every active vendor needs one', () => {
    const sub = (active: number, withLocation: number) =>
      row(
        buildChecklist(facts({ subprocessors: { active, withLocation } }), ['gdpr_eu']),
        'subprocessor_locations',
      ).status;
    expect(sub(2, 2)).toBe('built');
    expect(sub(2, 1)).toBe('partial');
    expect(sub(2, 0)).toBe('open');
    expect(sub(0, 0)).toBe('open');
  });
});

describe('settings rules', () => {
  const v = (patch: Partial<ComplianceSettingsValues>): ComplianceSettingsValues => ({
    ...COMPLIANCE_DEFAULTS,
    ...patch,
  });

  it('accepts the defaults', () => {
    expect(settingsProblems(COMPLIANCE_DEFAULTS)).toEqual([]);
  });

  it('refuses an unknown zone, an empty quiet period, a backwards calling window and no days', () => {
    const problems = settingsProblems(
      v({
        windowTimezone: 'Mars/Olympus',
        quietHours: { enabled: true, start: '21:00', end: '21:00' },
        callingWindow: { enabled: true, start: '21:00', end: '08:00', days: [] },
        secondaryNoticeLocale: 'en',
      }),
    );
    expect(problems.map((p) => p.path).sort()).toEqual(
      [
        'callingWindow.days',
        'callingWindow.end',
        'quietHours.end',
        'secondaryNoticeLocale',
        'windowTimezone',
      ].sort(),
    );
    expect(isKnownTimezone('Asia/Kolkata')).toBe(true);
    expect(isKnownTimezone('Mars/Olympus')).toBe(false);
  });

  it('ignores a disabled window even if its times are odd', () => {
    expect(
      settingsProblems(
        v({ callingWindow: { enabled: false, start: '21:00', end: '08:00', days: [] } }),
      ),
    ).toEqual([]);
  });

  it('the audit delta lists changed fields and never the officer contact values', () => {
    const next = v({
      regimes: ['dpdp_in'],
      dpo: { name: 'Sam Rao', email: 'sam@x.test', phone: '', address: '' },
      privacyUrl: 'https://x.test/p',
    });
    const delta = settingsDelta(COMPLIANCE_DEFAULTS, next);
    expect(Object.keys(delta).sort()).toEqual(['dpo', 'privacyUrl', 'regimes']);
    expect(JSON.stringify(delta)).not.toContain('sam@x.test');
    expect(JSON.stringify(delta)).not.toContain('Sam Rao');
    expect(settingsDelta(next, next)).toEqual({});
  });
});

describe('every explanation a row can carry has a text key', () => {
  it('walks the rules over many workspaces and finds only catalogued details', () => {
    const officers = [
      { name: '', email: '', phone: '', address: '' },
      { name: 'A', email: '', phone: '', address: '' },
      { name: 'A', email: 'a@x.test', phone: '', address: '' },
    ];
    const seen = new Set<string>();
    for (const dpo of officers)
      for (const childrenPolicy of ['unset', 'no_minors', 'may_include_minors'] as const)
        for (const parental of [false, true])
          for (const on of [false, true])
            for (const locale of [null, 'hi']) {
              const f = facts({
                settings: {
                  dpo,
                  grievanceOfficer: dpo,
                  childrenPolicy,
                  parentalConsentRequired: parental,
                  offerSaleShareOptOut: on,
                  optOutNoticeUrl: on ? 'https://x.test/o' : null,
                  privacyUrl: on ? 'https://x.test/p' : null,
                  termsUrl: null,
                  quietHours: { enabled: on, start: '21:00', end: '08:00' },
                  callingWindow: { ...COMPLIANCE_DEFAULTS.callingWindow, enabled: on },
                  dndRegistry: on ? 'custom' : 'none',
                  secondaryNoticeLocale: locale,
                },
                consent: { detectionEnabled: on, requireConsentForMarketing: !on },
                notices: {
                  enabledCount: on ? 2 : 0,
                  workspaceLocales: on ? ['en'] : locale ? ['hi'] : [],
                },
                requests: { slaDays: on ? 10 : 45, open: 2, overdue: on ? 1 : 0 },
                recording: { enabled: on, retentionDays: 30 },
                subprocessors: { active: on ? 2 : 0, withLocation: on ? 1 : 0 },
              });
              for (const i of buildChecklist(f, COMPLIANCE_REGIMES).items) {
                expect(Object.keys(CHECKLIST_DETAIL_KEYS), i.id).toContain(i.id);
                expect(CHECKLIST_DETAIL_KEYS[i.id], `${i.id}.${i.detail}`).toContain(i.detail);
                seen.add(`${i.id}.${i.detail}`);
              }
            }
    // The walk reaches most of the catalogue (the rest need a combination this grid does not make).
    const all = Object.entries(CHECKLIST_DETAIL_KEYS).flatMap(([id, ds]) =>
      ds.map((d) => `${id}.${d}`),
    );
    expect(seen.size).toBeGreaterThan(all.length * 0.7);
  });

  it('the catalogue covers every baseline and profile row id', () => {
    for (const id of [...BASELINE_ITEM_IDS, ...PROFILE_ITEM_IDS]) {
      expect(CHECKLIST_DETAIL_KEYS[id], id).toBeDefined();
    }
  });
});
