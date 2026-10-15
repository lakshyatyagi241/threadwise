import {
  GROWTH_FEATURES,
  growthConfigSchema,
  type CustomPhrase,
  type GrowthConfig,
  type GrowthFeature,
  type GrowthSettings,
  type ServiceRule,
  type UpdateGrowthSettingsInput,
} from '@crm/contracts';

/** The intents a phrase can mean, in the order the form lists them. */
export const PHRASE_INTENTS = [
  'ready_to_buy',
  'asking_price',
  'comparing',
  'registering',
  'needs_support',
  'post_purchase',
  'browsing',
  'not_interested',
] as const;

/**
 * The Controls form: numbers stay text while they are typed, and the three list settings are one line per entry (a person edits a
 * phrase table in a text box, not in thirty inputs).
 */
export interface ControlsForm {
  features: Record<GrowthFeature, boolean>;
  hotLeadConfidence: string;
  unansweredHours: string;
  lapsedDays: string;
  engagedOpens: string;
  stageMinOpens: string;
  stageWindowDays: string;
  stageRequireGroup: boolean;
  autoMinConfidence: string;
  autoDailyCap: string;
  /** One property key per line. */
  statusFields: string;
  /** `label | date property | days after | days until (optional)`, one rule per line. */
  serviceRules: string;
  /** `phrase = intent`, one per line. */
  customPhrases: string;
  /** One word or phrase per line. */
  extraMaskTerms: string;
}

const lines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

export function formFromSettings(s: GrowthSettings): ControlsForm {
  const c = s.config;
  return {
    features: { ...s.features },
    hotLeadConfidence: String(c.hotLeadConfidence),
    unansweredHours: String(c.unansweredHours),
    lapsedDays: String(c.lapsedDays),
    engagedOpens: String(c.engagedOpens),
    stageMinOpens: String(c.stageRule.minOpens),
    stageWindowDays: String(c.stageRule.windowDays),
    stageRequireGroup: c.stageRule.requireGroup,
    autoMinConfidence: String(c.autoStage.minConfidence),
    autoDailyCap: String(c.autoStage.dailyCap),
    statusFields: c.statusFields.join('\n'),
    serviceRules: c.serviceRules
      .map((r) =>
        [
          r.label,
          r.dateField,
          r.afterDays,
          ...(r.untilDays !== undefined ? [r.untilDays] : []),
        ].join(' | '),
      )
      .join('\n'),
    customPhrases: c.customPhrases.map((p) => `${p.phrase} = ${p.intent}`).join('\n'),
    extraMaskTerms: c.extraMaskTerms.join('\n'),
  };
}

export type ParseProblem =
  { field: 'serviceRules' | 'customPhrases'; line: number } | { field: 'numbers' };

export function parseServiceRules(text: string): { rules: ServiceRule[]; badLine: number | null } {
  const rules: ServiceRule[] = [];
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    const parts = all[i]!.split('|').map((p) => p.trim());
    if (parts.length < 3 || parts.length > 4) return { rules, badLine: i + 1 };
    const after = Number(parts[2]);
    const until = parts[3] === undefined || parts[3] === '' ? undefined : Number(parts[3]);
    if (!Number.isInteger(after) || (until !== undefined && !Number.isInteger(until))) {
      return { rules, badLine: i + 1 };
    }
    rules.push({
      label: parts[0]!,
      dateField: parts[1]!,
      afterDays: after,
      ...(until !== undefined ? { untilDays: until } : {}),
    });
  }
  return { rules, badLine: null };
}

export function parseCustomPhrases(text: string): {
  phrases: CustomPhrase[];
  badLine: number | null;
} {
  const phrases: CustomPhrase[] = [];
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    const at = all[i]!.lastIndexOf('=');
    if (at < 1) return { phrases, badLine: i + 1 };
    const phrase = all[i]!.slice(0, at).trim();
    const intent = all[i]!.slice(at + 1).trim();
    if (!(PHRASE_INTENTS as readonly string[]).includes(intent)) return { phrases, badLine: i + 1 };
    phrases.push({ phrase, intent: intent as CustomPhrase['intent'] });
  }
  return { phrases, badLine: null };
}

export type BuiltConfig = { ok: true; config: GrowthConfig } | { ok: false; problem: ParseProblem };

/** The thresholds and rules the form describes, checked against the contract (the server checks again). */
export function configFromForm(f: ControlsForm): BuiltConfig {
  const rules = parseServiceRules(f.serviceRules);
  if (rules.badLine !== null)
    return { ok: false, problem: { field: 'serviceRules', line: rules.badLine } };
  const phrases = parseCustomPhrases(f.customPhrases);
  if (phrases.badLine !== null)
    return { ok: false, problem: { field: 'customPhrases', line: phrases.badLine } };
  const parsed = growthConfigSchema.safeParse({
    hotLeadConfidence: Number(f.hotLeadConfidence),
    unansweredHours: Number(f.unansweredHours),
    lapsedDays: Number(f.lapsedDays),
    engagedOpens: Number(f.engagedOpens),
    stageRule: {
      minOpens: Number(f.stageMinOpens),
      windowDays: Number(f.stageWindowDays),
      requireGroup: f.stageRequireGroup,
    },
    autoStage: { minConfidence: Number(f.autoMinConfidence), dailyCap: Number(f.autoDailyCap) },
    statusFields: lines(f.statusFields),
    serviceRules: rules.rules,
    customPhrases: phrases.phrases,
    extraMaskTerms: lines(f.extraMaskTerms),
  });
  return parsed.success
    ? { ok: true, config: parsed.data }
    : { ok: false, problem: { field: 'numbers' } };
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function controlsDirty(form: ControlsForm, baseline: ControlsForm): boolean {
  return !sameJson(form, baseline);
}

/** The save: the switches that changed and, when any threshold or rule changed, the whole configuration. */
export function toSettingsInput(
  form: ControlsForm,
  baseline: ControlsForm,
  settings: GrowthSettings,
): { ok: true; input: UpdateGrowthSettingsInput } | { ok: false; problem: ParseProblem } {
  const features: Partial<Record<GrowthFeature, boolean>> = {};
  for (const k of GROWTH_FEATURES)
    if (form.features[k] !== baseline.features[k]) features[k] = form.features[k];
  const out: UpdateGrowthSettingsInput = { rowVersion: settings.rowVersion ?? undefined };
  if (Object.keys(features).length > 0) out.features = features;
  const rest = { ...form, features: baseline.features };
  if (!sameJson(rest, { ...baseline })) {
    const built = configFromForm(form);
    if (!built.ok) return built;
    out.config = built.config;
  }
  return { ok: true, input: out };
}
