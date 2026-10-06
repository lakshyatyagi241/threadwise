import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORM_CAPTCHA_MODES, lifecycleStageSchema } from '@crm/contracts';

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../../..');
const load = (locale: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, 'web-forms.share.json'), 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (m: string) =>
  [...new Set([...m.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((x) => x[1]!))].sort();

const en = flatten(load('en'));
const ar = flatten(load('ar'));

describe('share and settings messages', () => {
  it('has the same keys in English and Arabic, none empty', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries({ ...en, ...ar })) expect(v.trim(), k).not.toBe('');
  });

  it('uses the same placeholders in both languages', () => {
    for (const k of Object.keys(en)) expect(placeholders(ar[k]!), k).toEqual(placeholders(en[k]!));
  });

  it('writes the Arabic in Arabic', () => {
    // brand and format words stay Latin; every other message has Arabic letters
    const keep = new Set(['web-forms.settings.notify.emailPlaceholder']);
    for (const [k, v] of Object.entries(ar)) {
      if (keep.has(k)) continue;
      expect(v, k).toMatch(/[؀-ۿ]/);
    }
  });

  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');
  const literalKeys = (source: string) => [
    ...new Set([...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]!)),
  ];
  const templateKeys = (source: string) => [
    ...new Set([...source.matchAll(/\bt\(\s*`([^`]+)`/g)].map((m) => m[1]!)),
  ];

  const files = [
    { file: 'share-tab.tsx', ns: 'web-forms.share' },
    { file: 'settings-tab.tsx', ns: 'web-forms.settings' },
  ];

  for (const { file, ns } of files) {
    it(`has every key ${file} asks for under ${ns}`, () => {
      const src = read(file);
      const missing = literalKeys(src).filter((k) => !(`${ns}.${k}` in en));
      expect(missing).toEqual([]);
    });
  }

  it('has every key the code builds by name', () => {
    const expected: string[] = [];
    for (const m of ['archived', 'draft', 'paused', 'live']) {
      expected.push(`share.status.${m}.title`, `share.status.${m}.body`);
    }
    for (const i of ['empty', 'invalid', 'duplicate', 'max'])
      expected.push(`share.domains.issues.${i}`);
    for (const st of lifecycleStageSchema.options) expected.push(`settings.crm.stages.${st}`);
    for (const m of FORM_CAPTCHA_MODES) {
      expected.push(
        `settings.protection.captchaOptions.${m}`,
        `settings.protection.captchaHints.${m}`,
      );
    }
    for (const m of ['message', 'redirect']) {
      expected.push(`settings.after.modes.${m}`, `settings.after.modeHints.${m}`);
    }
    for (const m of ['none', 'email_domain', 'name_or_domain']) {
      expected.push(`settings.crm.companyOptions.${m}`, `settings.crm.companyHints.${m}`);
    }
    for (const m of ['unassigned', 'fixed', 'round_robin']) {
      expected.push(`settings.crm.ownerModes.${m}`, `settings.crm.ownerModeHints.${m}`);
    }
    for (const i of ['fixed_one', 'round_robin_two', 'unassigned_none', 'too_many']) {
      expected.push(`settings.crm.ownerIssues.${i}`);
    }
    for (const i of ['empty', 'too_long', 'duplicate', 'max'])
      expected.push(`settings.crm.tagIssues.${i}`);
    for (const i of ['empty', 'invalid', 'duplicate', 'max'])
      expected.push(`settings.notify.emailIssues.${i}`);
    for (const i of ['required', 'https']) expected.push(`settings.after.redirectIssues.${i}`);
    for (const i of ['nameRequired', 'submit_empty', 'submit_too_long'])
      expected.push(`settings.form.issues.${i}`);
    for (const r of ['perIpPerMinute', 'perFormPerMinute', 'perContactPerHour']) {
      expected.push(`settings.protection.rate.${r}`, `settings.protection.rate.${r}Hint`);
    }
    const missing = expected.filter((k) => !(`web-forms.${k}` in en));
    expect(missing).toEqual([]);
  });

  it('keeps every template-literal key inside a group this test knows about', () => {
    const groups = new Set([
      'status.${notice}.title',
      'status.${notice}.body',
      'domains.issues.${r.issue}',
      'form.issues.${nameIssue}',
      'form.issues.submit_${labelIssue}',
      'after.modeHints.${s.successMode}',
      'after.redirectIssues.${redirectProblem}',
      'crm.companyHints.${draft.mapping.company.match}',
      'crm.companyOptions.${m}',
      'crm.stages.${st}',
      'crm.tagIssues.${r.issue}',
      'crm.ownerModeHints.${live.ownerRule.mode}',
      'crm.ownerModes.${m}',
      'crm.ownerIssues.${ownerIssue}',
      'notify.emailIssues.${r.issue}',
      'notify.emailIssues.${storedEmailIssue}',
      'protection.captchaHints.${live.captchaMode}',
      'protection.captchaOptions.${m}',
      'protection.rate.${key}',
      'protection.rate.${key}Hint',
    ]);
    const used = [
      ...templateKeys(read('share-tab.tsx')),
      ...templateKeys(read('settings-tab.tsx')),
    ];
    expect(used.filter((k) => !groups.has(k))).toEqual([]);
  });
});
