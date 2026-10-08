import { describe, expect, it } from 'vitest';
import { REPORT_LIVE_METRICS, isReportLiveMetric, reportLiveMetricKeys } from '@crm/contracts';
import {
  FIGURE_LIMITS,
  extractFigures,
  parseNumber,
  splitLine,
} from '../../../src/modules/report-copilot/report-figures';
import { buildSystemPrompt } from '../../../src/modules/report-copilot/report-prompt';
import { figuresOutput } from '../../../src/modules/report-copilot/report-tool-output';

describe('parseNumber', () => {
  it.each([
    ['1234', 1234, undefined],
    ['1,234.50', 1234.5, undefined],
    ['$1,200', 1200, '$'],
    ['-$1,200', -1200, '$'],
    ['$-1,200', -1200, '$'],
    ['(1,200)', -1200, undefined],
    ['12.5%', 12.5, '%'],
    ['1.2M', 1.2, 'M'],
    ['USD 450', 450, 'USD'],
    ['450 USD', 450, 'USD'],
    ['₹ 99,000', 99000, '₹'],
    ['12 messages', 12, 'messages'],
    ['.5', 0.5, undefined],
    ['−7', -7, undefined],
  ])('reads %s', (text, value, unit) => {
    const p = parseNumber(text);
    expect(p?.value).toBe(value);
    expect(p?.unit).toBe(unit);
  });

  it.each([
    '',
    'n/a',
    'Q3',
    '12,5',
    '1 234',
    '1.234,5',
    '2026-01-05',
    '12:30',
    '(12',
    '12)',
    '--5',
    '1,23,456',
    'about 12',
    'x'.repeat(60),
  ])('does not guess at %j', (text) => {
    expect(parseNumber(text)).toBeNull();
  });
});

describe('splitLine', () => {
  it('splits CSV with quotes and escaped quotes', () => {
    expect(splitLine('a,"b, c","d ""e"""', 'comma')).toEqual(['a', 'b, c', 'd "e"']);
  });
  it('drops the outer bars of a pipe table and trims cells', () => {
    expect(splitLine('| a | b |', 'pipe')).toEqual(['a', 'b']);
    expect(splitLine('a | b', 'pipe')).toEqual(['a', 'b']);
  });
  it('splits tab and semicolon', () => {
    expect(splitLine('a\tb', 'tab')).toEqual(['a', 'b']);
    expect(splitLine('a;b;', 'semicolon')).toEqual(['a', 'b', '']);
  });
});

const CSV = [
  'Month,Web,Email,Social',
  'Jan,"$1,200",$800,$300',
  'Feb,"$1,500",$950,$410',
  'Mar,"$1,100",$700,n/a',
].join('\n');

describe('extractFigures: tables', () => {
  it('types the columns, keeps the original text of every number and sums them', () => {
    const f = extractFigures(CSV);
    expect(f.tables).toHaveLength(1);
    const t = f.tables[0]!;
    expect(t.delimiter).toBe('comma');
    expect(t.startLine).toBe(1);
    expect(t.startOffset).toBe(0);
    expect(t.totalRows).toBe(3);
    expect(t.columns.map((c) => [c.name, c.type, c.unit])).toEqual([
      ['Month', 'text', undefined],
      ['Web', 'number', '$'],
      ['Email', 'number', '$'],
      // 2 of 3 filled cells (67%) are numbers, below the 80% bar: the column is text and "$300" stays as the document wrote it
      ['Social', 'text', undefined],
    ]);
    expect(t.columns[1]).toMatchObject({ sum: 3800, numbers: 3 });
    expect(t.rows[0]).toEqual({
      line: 2,
      cells: ['Jan', { text: '$1,200', value: 1200 }, { text: '$800', value: 800 }, '$300'],
    });
    expect(t.rows[2]!.cells[3]).toBe('n/a');
  });

  it('a column that is mostly numbers stays numeric and the odd cell stays text', () => {
    const rows = ['Item,Qty'];
    for (let i = 1; i <= 9; i++) rows.push(`i${i},${i}`);
    rows.push('i10,n/a');
    const t = extractFigures(rows.join('\n')).tables[0]!;
    expect(t.columns[1]).toMatchObject({ type: 'number', numbers: 9, sum: 45 });
    expect(t.rows[9]!.cells[1]).toBe('n/a');
  });

  it('reads tab, semicolon, pipe and Markdown tables, skipping the separator row', () => {
    const md = '| Channel | Revenue |\n| --- | ---: |\n| Web | 1,200 |\n| Email | 800 |';
    const f = extractFigures(`Intro text\n\n${md}\n\ntrailing`);
    const t = f.tables[0]!;
    expect(t.delimiter).toBe('pipe');
    expect(t.startLine).toBe(3);
    expect(t.rows.map((r) => r.line)).toEqual([5, 6]);
    expect(t.columns[1]).toMatchObject({ type: 'number', sum: 2000 });
    expect(extractFigures('a\tb\nx\t1\ny\t2').tables[0]!.delimiter).toBe('tab');
    expect(extractFigures('a;b\nx;1\ny;2').tables[0]!.delimiter).toBe('semicolon');
  });

  it('gives the offset of the header so the source can be read', () => {
    const text = `Notes\nmore notes\n${CSV}`;
    const t = extractFigures(text).tables[0]!;
    expect(t.startLine).toBe(3);
    expect(text.slice(t.startOffset, t.startOffset + 5)).toBe('Month');
  });

  it('units that differ stay on each cell and the column has no sum', () => {
    const t = extractFigures('k,v\na,10%\nb,$5').tables[0]!;
    expect(t.columns[1]!.unit).toBeUndefined();
    expect(t.columns[1]!.sum).toBeUndefined();
    expect(t.rows[0]!.cells[1]).toEqual({ text: '10%', value: 10, unit: '%' });
  });

  it('a first row of numbers is data, not a header', () => {
    const t = extractFigures('10,20\n30,40').tables[0]!;
    expect(t.columns.map((c) => c.name)).toEqual(['column 1', 'column 2']);
    expect(t.totalRows).toBe(2);
  });

  it('prose with commas, and a table with no numbers, are not tables', () => {
    expect(extractFigures('Hello, world\nOK, fine\nSure, yes').tables).toEqual([]);
    expect(extractFigures('a,b\nc,d').tables).toEqual([]);
  });

  it('a ragged row ends the table', () => {
    const t = extractFigures('a,b\n1,2\n3,4\n5,6,7\n8,9').tables;
    expect(t[0]!.totalRows).toBe(2);
  });

  it('is deterministic', () => {
    expect(extractFigures(CSV)).toEqual(extractFigures(CSV));
  });

  it('caps rows per table, tables and says it cut', () => {
    const big = ['n,v'];
    for (let i = 0; i < FIGURE_LIMITS.rowsPerTable + 50; i++) big.push(`r${i},${i}`);
    const f = extractFigures(big.join('\n'));
    expect(f.tables[0]!.rows).toHaveLength(FIGURE_LIMITS.rowsPerTable);
    expect(f.tables[0]!.totalRows).toBe(FIGURE_LIMITS.rowsPerTable + 50);
    expect(f.tables[0]!.rowsCut).toBe(true);
    expect(f.cut).toBe(true);

    const many = Array.from(
      { length: FIGURE_LIMITS.tables + 3 },
      (_, i) => `t${i},v\na,1\nb,2`,
    ).join('\n\n');
    const m = extractFigures(many);
    expect(m.tables).toHaveLength(FIGURE_LIMITS.tables);
    expect(m.tablesFound).toBe(FIGURE_LIMITS.tables + 3);
    expect(m.cut).toBe(true);
  });

  it('refuses tables wider than the column cap, and clips long cells', () => {
    const wide = Array.from({ length: FIGURE_LIMITS.columns + 1 }, (_, i) => `c${i}`).join(',');
    expect(extractFigures(`${wide}\n${wide.replace(/c/g, '1')}`).tables).toEqual([]);
    const long = 'x'.repeat(500);
    const t = extractFigures(`name,v\n${long},1\nb,2`).tables[0]!;
    expect((t.rows[0]!.cells[0] as string).length).toBe(FIGURE_LIMITS.cellChars);
  });
});

describe('extractFigures: label: number lines', () => {
  it('reads bullets, bold labels and units, with line and offset', () => {
    const text =
      'Q3 summary\n- Total revenue: $48,200\n**Churn:** 2.1%\n3. Active users = 1,240\nWe grew, a lot: yes';
    const f = extractFigures(text);
    expect(f.lines.map((l) => [l.label, l.text, l.value, l.unit, l.line])).toEqual([
      ['Total revenue', '$48,200', 48200, '$', 2],
      ['Churn', '2.1%', 2.1, '%', 3],
      ['Active users', '1,240', 1240, undefined, 4],
    ]);
    expect(text.slice(f.lines[0]!.offset).startsWith('- Total revenue')).toBe(true);
  });

  it('ignores numbers in sentences, times and ambiguous decimals', () => {
    const f = extractFigures(
      'Revenue: grew by 5% this year\nTime: 10:30\nPrice: 12,5\nNote: see below',
    );
    expect(f.lines).toEqual([]);
  });

  it('does not repeat lines already read as part of a table', () => {
    const f = extractFigures('a: 1\nk,v\nx,1\ny,2');
    expect(f.lines.map((l) => l.label)).toEqual(['a']);
  });

  it('strips markup characters from labels', () => {
    const f = extractFigures('- <b>Sneaky</b> label: 5');
    expect(f.lines[0]!.label).toBe('bSneaky/b label');
  });

  it('caps the lines and says it cut', () => {
    const text = Array.from({ length: FIGURE_LIMITS.pairs + 10 }, (_, i) => `m${i}: ${i}`).join(
      '\n',
    );
    const f = extractFigures(text);
    expect(f.lines).toHaveLength(FIGURE_LIMITS.pairs);
    expect(f.linesFound).toBe(FIGURE_LIMITS.pairs + 10);
    expect(f.cut).toBe(true);
  });
});

describe('figuresOutput', () => {
  it('labels the data as untrusted and names the source, and says what to do when nothing is found', () => {
    const doc = {
      uuid: '11111111-1111-4111-8111-111111111111',
      name: 'Revenue.csv',
      truncated: false,
    };
    const out = figuresOutput(doc, extractFigures(CSV));
    expect(out.notice).toMatch(/UNTRUSTED/);
    expect(out.source).toBe('document "Revenue.csv"');
    expect(out.tables).toHaveLength(1);
    expect(out.next).toBeUndefined();
    const none = figuresOutput(doc, extractFigures('Just prose here.'));
    expect(none.next).toMatch(/not found in the documents/);
  });
});

describe('live metric whitelist', () => {
  it('has unique keys per scope, a label each, and a known unit', () => {
    for (const scope of ['workspace', 'platform'] as const) {
      const keys = reportLiveMetricKeys(scope);
      expect(new Set(keys).size).toBe(keys.length);
      for (const m of REPORT_LIVE_METRICS[scope]) {
        expect(m.label.length).toBeGreaterThan(0);
        expect(['count', 'percent', 'money']).toContain(m.unit);
      }
    }
  });
  it('keeps the two scopes apart', () => {
    expect(isReportLiveMetric('workspace', 'contacts.total')).toBe(true);
    expect(isReportLiveMetric('workspace', 'platform.income')).toBe(false);
    expect(isReportLiveMetric('platform', 'platform.income')).toBe(true);
    expect(isReportLiveMetric('platform', 'contacts.total')).toBe(false);
    expect(isReportLiveMetric('workspace', 'contacts.total; drop')).toBe(false);
  });
});

describe('the system prompt', () => {
  const ws = buildSystemPrompt('workspace', new Date('2026-10-08T00:00:00Z'), '30d');
  const pl = buildSystemPrompt('platform', new Date('2026-10-08T00:00:00Z'));

  it('makes the controlled components the default and the sandbox page opt-in', () => {
    for (const p of [ws, pl]) {
      for (const name of [
        'show_summary',
        'show_kpis',
        'show_chart',
        'show_table',
        'render_report',
        'extract_document_figures',
      ]) {
        expect(p).toContain(name);
      }
      expect(p).toMatch(/generateSandboxedUi ONLY when the person explicitly asks/);
      expect(p).toMatch(/not found in the documents/);
      expect(p).toMatch(/UNTRUSTED DATA/);
    }
  });
  it('lists only the live keys of its own scope', () => {
    expect(ws).toContain('contacts.total = Contacts');
    expect(ws).not.toContain('platform.income');
    expect(pl).toContain('platform.income = Income');
    expect(pl).not.toContain('contacts.total');
    expect(pl).not.toContain('get_dashboard_summary');
  });
});
