import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_DOCUMENT_EXTENSIONS, reportWindowSchema } from '@crm/contracts';

/**
 * Every literal message key a component asks for exists in messages/en/report-copilot.json (next-intl would otherwise print the
 * key path on screen). Keys built at run time are covered by the dynamic checks below.
 */
const WEB = resolve(__dirname, '../../..');
type Tree = { [k: string]: string | Tree };
const read = (file: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages/en', file), 'utf8')) as Tree;
const tree = read('report-copilot.json');
const charts = read('dashboards-analytics-charts.json');

function has(root: Tree, path: string): boolean {
  let cur: string | Tree | undefined = root;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === undefined) return false;
    cur = cur[part];
  }
  return cur !== undefined;
}

const dir = join(__dirname, 'components');
const files = readdirSync(dir).filter(
  (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx') && f !== 'test-utils.tsx',
);

describe('report assistant messages', () => {
  it.each(files)('%s asks only for keys that exist', (file) => {
    // each component function declares its own translators, so check them one function at a time
    const blocks = readFileSync(join(dir, file), 'utf8').split(
      /\n(?=export (?:default )?function |function )/,
    );
    const missing: string[] = [];
    for (const src of blocks) {
      const namespaces = [...src.matchAll(/const (\w+) = useTranslations\(\s*'([^']+)'\s*\)/g)].map(
        (m) => [m[1]!, m[2]!] as const,
      );
      for (const [v, ns] of namespaces) {
        for (const m of src.matchAll(new RegExp(`\\b${v}\\('([^']+)'`, 'g'))) {
          const root = ns.startsWith('dashboards-analytics-charts') ? charts : tree;
          if (!has(root, `${ns}.${m[1]}`)) missing.push(`${ns}.${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('the run-time keys resolve: windows, hints, statuses, errors, suggestions, key notices', () => {
    const b = 'report-copilot';
    const keys = [
      ...reportWindowSchema.options.map((w) => `panel.window.${w}`),
      ...['workspace', 'platform'].map((s) => `page.description.${s}`),
      'nav.title',
      ...['ready', 'failed'].map((s) => `documents.status.${s}`),
      ...['tooBig', 'badType', 'unreadable', 'full', 'network', 'generic', 'forbidden'].map(
        (k) => `documents.error.${k}`,
      ),
      ...['summarise', 'performance', 'compare'].flatMap((k) => [
        `chat.suggestion.${k}.title`,
        `chat.suggestion.${k}.message`,
      ]),
      ...['workspace', 'platform', 'providerUnsupported', 'link'].map(
        (k) => `chat.keyRequired.${k}`,
      ),
    ];
    expect(keys.filter((k) => !has(tree, `${b}.${k}`))).toEqual([]);
  });

  it('carries the product wording the owner asked for', () => {
    expect(has(tree, 'report-copilot.chat.keyRequired.workspace')).toBe(true);
    const t = (p: string) =>
      p.split('.').reduce<string | Tree>((c, k) => (c as Tree)[k]!, tree) as string;
    expect(t('report-copilot.chat.keyRequired.workspace')).toBe(
      'Add an AI key in Settings to use the assistant.',
    );
    expect(t('report-copilot.chat.keyRequired.platform')).toBe(
      'Add a platform AI key to use the assistant.',
    );
    expect(t('report-copilot.report.error.title')).toBe(
      'The assistant sent a report we could not draw',
    );
    expect(t('report-copilot.chat.suggestion.summarise.title')).toBe('Summarise my documents');
    expect(t('report-copilot.chat.suggestion.performance.title')).toBe(
      'Build a performance report for the last 30 days',
    );
    expect(t('report-copilot.chat.suggestion.compare.title')).toBe(
      "Compare the PDF with this month's numbers",
    );
  });

  it('has a string for every file type the library accepts being listed', () => {
    // the accepted list is printed from the contract, so a new extension needs no message change
    expect(REPORT_DOCUMENT_EXTENSIONS.length).toBeGreaterThan(0);
    expect(has(tree, 'report-copilot.documents.accepted')).toBe(true);
  });
});
