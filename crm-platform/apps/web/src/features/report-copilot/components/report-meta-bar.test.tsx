import { describe, expect, it } from 'vitest';
import type { ReportMeta } from '../lib/canvas';
import { ReportMetaBar } from './report-meta-bar';
import { html } from './test-utils';

const meta: ReportMeta = {
  prompt: 'Build a report',
  generatedAt: Date.UTC(2026, 9, 8, 14, 5),
  documents: 3,
};
const render = (over: Partial<ReportMeta> = {}, running = false) =>
  html(<ReportMetaBar meta={{ ...meta, ...over }} running={running} onRefresh={() => undefined} />);

describe('ReportMetaBar', () => {
  it('says when the report was made and from how many documents', () => {
    const out = render();
    expect(out).toContain('Generated');
    expect(out).toContain('3 documents');
    expect(render({ documents: 1 })).toContain('1 document');
    expect(render({ documents: 1 })).not.toContain('1 documents');
  });

  it('offers Refresh data when there is a request to ask again', () => {
    const out = render();
    expect(out).toContain('Refresh data');
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Refresh data/);
  });

  it('is disabled while the assistant is running, and when the question is not known', () => {
    expect(render({}, true)).toMatch(/<button[^>]*disabled=""[^>]*>Refreshing…/);
    expect(render({ prompt: null })).toMatch(/<button[^>]*disabled=""[^>]*>Refresh data/);
  });
});
