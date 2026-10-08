import { describe, expect, it } from 'vitest';
import {
  actionResult,
  parseReportSpec,
  readActionResult,
  RENDER_REPORT_ACTION,
} from './render-report';

const good = {
  title: 'Performance, last 30 days',
  summary: 'Sends are up.',
  sections: [
    {
      heading: 'Volume',
      body: 'Sent **12k** messages.',
      chart: { type: 'bar', series: [{ name: 'Sent', points: [{ label: 'W1', value: 3 }] }] },
    },
  ],
};

describe('render_report', () => {
  it('is the action name the server prompt uses', () => {
    expect(RENDER_REPORT_ACTION).toBe('render_report');
  });

  it('accepts a valid report and fills the defaults the model may leave out', () => {
    const out = parseReportSpec(good);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.spec.kpis).toEqual([]);
      expect(out.spec.sources).toEqual([]);
    }
  });

  it('turns a malformed report into issues, never an exception', () => {
    const out = parseReportSpec({ title: '', sections: [] });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.issues.length).toBeGreaterThan(0);
      expect(out.issues.join(' ')).toContain('title');
      expect(out.issues.join(' ')).toContain('sections');
    }
  });

  it('rejects things that are not a report at all', () => {
    for (const bad of [null, undefined, 'a string', 42, []]) {
      expect(parseReportSpec(bad).ok).toBe(false);
    }
  });

  it('rejects a chart the schema does not allow (unknown type, too many points)', () => {
    const unknownType = {
      ...good,
      sections: [{ heading: 'H', body: '', chart: { type: 'radar', series: [] } }],
    };
    expect(parseReportSpec(unknownType).ok).toBe(false);
    const many = {
      ...good,
      sections: [
        {
          heading: 'H',
          body: '',
          chart: {
            type: 'line',
            series: [
              {
                name: 's',
                points: Array.from({ length: 61 }, (_, i) => ({ label: `${i}`, value: i })),
              },
            ],
          },
        },
      ],
    };
    expect(parseReportSpec(many).ok).toBe(false);
  });

  it('caps the issue list so a very wrong report does not flood the card', () => {
    const out = parseReportSpec({ title: 1, summary: 2, kpis: 3, sections: 4, sources: 5 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues.length).toBeLessThanOrEqual(5);
  });

  it('hands the model an ok result, or the issues and a hint to try again', () => {
    const ok = parseReportSpec(good);
    expect(readActionResult(actionResult(ok))).toEqual({
      ok: true,
      title: 'Performance, last 30 days',
      issues: [],
    });
    const bad = parseReportSpec({});
    const back = readActionResult(actionResult(bad));
    expect(back?.ok).toBe(false);
    expect(back?.issues.length).toBeGreaterThan(0);
    expect(actionResult(bad)).toContain('call render_report again');
  });

  it('reads anything that is not an action result as null', () => {
    expect(readActionResult(undefined)).toBeNull();
    expect(readActionResult('')).toBeNull();
    expect(readActionResult('Error: boom')).toBeNull();
    expect(readActionResult('{"x":1}')).toBeNull();
  });
});
