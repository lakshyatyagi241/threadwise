import {
  BASELINE_ITEM_IDS,
  effectivePolicy,
  type ChecklistItem,
  type ChecklistStatus,
  type ComplianceChecklist,
  type ComplianceRegime,
  type ComplianceRequirement,
  type ComplianceSettingsValues,
  REGIME_PROFILES,
} from '@crm/contracts';

/**
 * What the checklist is worked out from: settings the workspace saved and counts read from its own data. Nothing here is a judgement
 * about a law. The checklist says which tools and settings are in place (built), only half in place (partial) or not started (open).
 */
export interface ChecklistFacts {
  settings: ComplianceSettingsValues;
  consent: { detectionEnabled: boolean; requireConsentForMarketing: boolean };
  notices: {
    /** Intake points (widget, booking page, store, workspace default) whose current notice is switched on. */
    enabledCount: number;
    /** Languages of the enabled workspace default notice. */
    workspaceLocales: string[];
  };
  requests: { slaDays: number; open: number; overdue: number };
  recording: { enabled: boolean; retentionDays: number };
  subprocessors: { active: number; withLocation: number };
}

const SCREEN = '/compliance';
const tab = (name: string) => `${SCREEN}?tab=${name}`;

const item = (
  id: string,
  scope: ChecklistItem['scope'],
  status: ChecklistStatus,
  detail: string,
  href: string | null,
  params: ChecklistItem['params'] = {},
  regimes: ComplianceRegime[] = [],
): ChecklistItem => ({ id, scope, regimes, status, detail, params, href });

const has = (v: string): boolean => v.trim() !== '';
const officerState = (o: { name: string; email: string }): 'both' | 'one' | 'none' =>
  has(o.name) && has(o.email) ? 'both' : has(o.name) || has(o.email) ? 'one' : 'none';

export function baselineItems(f: ChecklistFacts): ChecklistItem[] {
  const s = f.settings;
  const out: ChecklistItem[] = [];

  // B1: the purpose registry and the ledger come with the platform.
  out.push(item('lawful_basis', 'baseline', 'built', 'built', '/contact-consent'));

  // B2: withdrawal works when detection is on; real consent means opt-in is required.
  out.push(
    !f.consent.detectionEnabled
      ? item('consent_withdrawal', 'baseline', 'open', 'detectionOff', '/contact-consent')
      : f.consent.requireConsentForMarketing
        ? item('consent_withdrawal', 'baseline', 'built', 'built', '/contact-consent')
        : item('consent_withdrawal', 'baseline', 'partial', 'optInOff', '/contact-consent'),
  );

  // B3: a default notice for the workspace; other consent lines count as a start.
  const workspaceNotice = f.notices.workspaceLocales.length > 0;
  out.push(
    workspaceNotice
      ? item('notices', 'baseline', 'built', 'built', tab('notices'), {
          languages: f.notices.workspaceLocales.length,
          lines: f.notices.enabledCount,
        })
      : f.notices.enabledCount > 0
        ? item('notices', 'baseline', 'partial', 'noDefault', tab('notices'), {
            lines: f.notices.enabledCount,
          })
        : item('notices', 'baseline', 'open', 'none', tab('notices')),
  );

  // B4: the tool exists for every workspace; it counts when someone can be reached and nothing is late.
  const dpo = officerState(s.dpo);
  out.push(
    f.requests.overdue > 0
      ? item('rights', 'baseline', 'partial', 'overdue', '/privacy-requests', {
          overdue: f.requests.overdue,
          open: f.requests.open,
        })
      : dpo === 'none'
        ? item('rights', 'baseline', 'partial', 'noContact', tab('contacts'), {
            days: f.requests.slaDays,
          })
        : item('rights', 'baseline', 'built', 'built', '/privacy-requests', {
            days: f.requests.slaDays,
            open: f.requests.open,
          }),
  );

  // B5: recordings have a retention window and a hold; the general retention engine is not built (BL-146).
  out.push(
    f.recording.enabled
      ? item('retention', 'baseline', 'partial', 'recordingsOn', null, {
          days: f.recording.retentionDays,
        })
      : item('retention', 'baseline', 'partial', 'recordingsOff', null),
  );

  // B6: platform controls exist; the breach runbook is a skeleton the operator completes.
  out.push(item('security', 'baseline', 'partial', 'runbook', null));

  // B7: the list, and the DPA template that is always available.
  out.push(
    f.subprocessors.active > 0
      ? item('subprocessors', 'baseline', 'built', 'built', tab('subprocessors'), {
          count: f.subprocessors.active,
        })
      : item('subprocessors', 'baseline', 'open', 'none', tab('subprocessors')),
  );

  // B8: the children flag.
  out.push(
    s.childrenPolicy === 'unset'
      ? item('children', 'baseline', 'open', 'unset', tab('contacts'))
      : s.childrenPolicy === 'may_include_minors' && !s.parentalConsentRequired
        ? item('children', 'baseline', 'partial', 'minorsNoParental', tab('contacts'))
        : item('children', 'baseline', 'built', s.childrenPolicy, tab('contacts')),
  );

  // B9: a contact and the links.
  const links = (s.privacyUrl ? 1 : 0) + (s.termsUrl ? 1 : 0);
  const reachable = dpo !== 'none' || has(s.dpo.phone) || has(s.dpo.address);
  out.push(
    links === 2 && reachable
      ? item('contact_links', 'baseline', 'built', 'built', tab('links'))
      : links === 0 && !reachable
        ? item('contact_links', 'baseline', 'open', 'none', tab('links'))
        : item('contact_links', 'baseline', 'partial', 'some', tab('links'), { links }),
  );

  // Keep the order of the contract so the screen and the text keys stay in step.
  return BASELINE_ITEM_IDS.map((id) => out.find((i) => i.id === id)!);
}

/** The regimes that ask for a requirement, among those switched on. */
const askedBy = (
  regimes: readonly ComplianceRegime[],
  requirement: ComplianceRequirement,
): ComplianceRegime[] =>
  regimes.filter((r) => REGIME_PROFILES[r].requirements.includes(requirement));

export function profileItems(
  f: ChecklistFacts,
  regimes: readonly ComplianceRegime[],
): ChecklistItem[] {
  const s = f.settings;
  const policy = effectivePolicy(regimes);
  const out: ChecklistItem[] = [];
  const add = (
    req: ComplianceRequirement,
    status: ChecklistStatus,
    detail: string,
    href: string | null,
    params: ChecklistItem['params'] = {},
  ) => out.push(item(req, 'profile', status, detail, href, params, askedBy(regimes, req)));

  for (const req of policy.requirements) {
    switch (req) {
      case 'dpo_contact': {
        const o = officerState(s.dpo);
        add(
          req,
          o === 'both' ? 'built' : o === 'one' ? 'partial' : 'open',
          o === 'both' ? 'built' : o,
          tab('contacts'),
        );
        break;
      }
      case 'grievance_officer': {
        const o = officerState(s.grievanceOfficer);
        add(
          req,
          o === 'both' ? 'built' : o === 'one' ? 'partial' : 'open',
          o === 'both' ? 'built' : o,
          tab('contacts'),
        );
        break;
      }
      case 'notice_languages': {
        const second = s.secondaryNoticeLocale;
        const haveEn = f.notices.workspaceLocales.includes('en');
        const haveSecond = second !== null && f.notices.workspaceLocales.includes(second);
        if (haveEn && haveSecond) add(req, 'built', 'built', tab('notices'), { locale: second });
        else if (haveEn || haveSecond)
          add(
            req,
            'partial',
            second === null ? 'noSecond' : haveEn ? 'secondMissing' : 'englishMissing',
            tab('notices'),
          );
        else add(req, 'open', second === null ? 'noSecond' : 'none', tab('notices'));
        break;
      }
      case 'parental_flag': {
        if (s.childrenPolicy === 'unset') add(req, 'open', 'unset', tab('contacts'));
        else if (s.childrenPolicy === 'may_include_minors' && !s.parentalConsentRequired)
          add(req, 'partial', 'minorsNoParental', tab('contacts'), { age: policy.minorAge ?? 18 });
        else add(req, 'built', s.childrenPolicy, tab('contacts'), { age: policy.minorAge ?? 18 });
        break;
      }
      case 'opt_out_notice': {
        if (s.offerSaleShareOptOut && s.optOutNoticeUrl)
          add(req, 'built', 'built', tab('profiles'));
        else if (s.offerSaleShareOptOut) add(req, 'partial', 'noUrl', tab('profiles'));
        else add(req, 'open', 'off', tab('profiles'));
        break;
      }
      case 'quiet_hours':
        add(
          req,
          s.quietHours.enabled ? 'built' : 'open',
          s.quietHours.enabled ? 'built' : 'off',
          tab('windows'),
          {
            start: s.quietHours.start,
            end: s.quietHours.end,
          },
        );
        break;
      case 'calling_window':
        add(
          req,
          s.callingWindow.enabled ? 'built' : 'open',
          s.callingWindow.enabled ? 'built' : 'off',
          tab('windows'),
          {
            start: s.callingWindow.start,
            end: s.callingWindow.end,
          },
        );
        break;
      case 'dnd_registry':
        // A choice of registry is a note: nothing is fetched from it, so it is never "built".
        add(
          req,
          s.dndRegistry === 'none' ? 'open' : 'partial',
          s.dndRegistry === 'none' ? 'off' : 'hookOnly',
          tab('windows'),
          {
            registry: s.dndRegistry,
          },
        );
        break;
      case 'subprocessor_locations': {
        const { active, withLocation } = f.subprocessors;
        if (active > 0 && withLocation === active)
          add(req, 'built', 'built', tab('subprocessors'), { count: active });
        else if (withLocation > 0)
          add(req, 'partial', 'some', tab('subprocessors'), { missing: active - withLocation });
        else
          add(req, 'open', active === 0 ? 'none' : 'some', tab('subprocessors'), {
            missing: active,
          });
        break;
      }
      case 'request_days': {
        const days = policy.requestDays;
        if (days === null) break;
        add(
          req,
          f.requests.slaDays <= days ? 'built' : 'partial',
          f.requests.slaDays <= days ? 'built' : 'tooLong',
          '/privacy-requests',
          { days, sla: f.requests.slaDays },
        );
        break;
      }
      case 'marketing_opt_in':
        add(
          req,
          f.consent.requireConsentForMarketing ? 'built' : 'open',
          f.consent.requireConsentForMarketing ? 'built' : 'off',
          '/contact-consent',
        );
        break;
    }
  }

  // Quiet hours and calling windows are enforced (BL-177): a marketing message is held, a call outside the window is refused. Said once,
  // plainly, whenever one is switched on, with what it does not do.
  if (s.quietHours.enabled || s.callingWindow.enabled) {
    out.push(
      item(
        'windows_enforcement',
        'profile',
        'built',
        'enforced',
        tab('windows'),
        {},
        regimes.filter(
          (r) =>
            REGIME_PROFILES[r].quietHours !== null || REGIME_PROFILES[r].callingWindow !== null,
        ),
      ),
    );
  }
  return out;
}

export function buildChecklist(
  f: ChecklistFacts,
  regimes: readonly ComplianceRegime[],
  now: Date = new Date(),
): ComplianceChecklist {
  const items = [...baselineItems(f), ...profileItems(f, regimes)];
  const summary = { built: 0, partial: 0, open: 0 };
  for (const i of items) summary[i.status] += 1;
  return { generatedAt: now.toISOString(), regimes: [...regimes], items, summary };
}
