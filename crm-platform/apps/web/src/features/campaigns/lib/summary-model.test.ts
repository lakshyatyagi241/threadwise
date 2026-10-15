import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFormatter, createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import {
  BYTE_ORDER_MARK,
  buildHeadline,
  buildTiles,
  busiestDay,
  caveatLines,
  cleanFormIds,
  csvCell,
  csvFileName,
  defaultTab,
  formKey,
  funnelRows,
  headlineText,
  isNotSent,
  isStillSending,
  parseWindow,
  peopleCsv,
  pctWords,
  searchWithWindow,
} from './summary-model';
import { summaryFixture } from './summary-fixtures';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'campaigns.json'), 'utf8'),
) as Record<string, unknown>;

function sentence(s = summaryFixture(), locale = 'en') {
  const t = createTranslator({
    locale,
    messages: messages as never,
    namespace: 'campaigns.detail.summary.headline' as never,
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const f = createFormatter({ locale });
  return headlineText(s, t, (items) => f.list(items, { type: 'conjunction' }));
}

describe('the window in the address', () => {
  it('accepts 3, 7 and 14 and falls back to 7 for anything else', () => {
    expect(parseWindow('3')).toBe(3);
    expect(parseWindow('14')).toBe(14);
    for (const bad of [null, undefined, '', '5', '0', '-7', 'abc', '7.5', '30']) {
      expect(parseWindow(bad)).toBe(7);
    }
  });

  it('sets the window and keeps the tab and every other parameter', () => {
    expect(searchWithWindow('tab=summary', 14)).toBe('tab=summary&window=14');
    expect(searchWithWindow('window=3&tab=replies', 7)).toBe('window=7&tab=replies');
    expect(searchWithWindow('', 3)).toBe('window=3');
    // A value outside the choices never reaches the address.
    expect(searchWithWindow('', 99)).toBe('window=7');
  });
});

describe('the picked forms', () => {
  it('gives the same key for the same choice in any order, without repeats', () => {
    expect(formKey(['b', 'a', 'b'])).toBe('a,b');
    expect(formKey([])).toBe('');
  });

  it('keeps only id-shaped strings from storage, at most 50', () => {
    const id = '00000000-0000-4000-8000-000000000009';
    expect(cleanFormIds([id, id, 'x', 5, null, '<script>'])).toEqual([id]);
    expect(cleanFormIds('nope')).toEqual([]);
    expect(
      cleanFormIds(
        Array.from(
          { length: 80 },
          (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        ),
      ),
    ).toHaveLength(50);
  });
});

describe('percentages in words', () => {
  it('says none, everyone, less than one, or a whole percent', () => {
    expect(pctWords(0, 100)).toEqual({ key: 'zero' });
    expect(pctWords(5, 0)).toEqual({ key: 'zero' });
    expect(pctWords(100, 100)).toEqual({ key: 'everyone' });
    expect(pctWords(1, 1000)).toEqual({ key: 'less' });
    expect(pctWords(164, 1240)).toEqual({ key: 'of', pct: 13 });
  });

  it('never rounds up to 100 while somebody is missing', () => {
    expect(pctWords(996, 1000)).toEqual({ key: 'of', pct: 99 });
  });
});

describe('the headline', () => {
  it('builds the plain sentence from the numbers', () => {
    expect(sentence()).toBe(
      'You messaged 1,240 people. 1,150 received it, 810 opened it, 164 wrote back within 7 days, and 31 filled in an application form.',
    );
  });

  it('uses singular forms', () => {
    const s = summaryFixture({
      people: { messaged: 1, delivered: 1, read: 1, failed: 0, notTrackable: 0 },
      cameBack: { count: 1, pctOfMessaged: 100, pctOfDelivered: 100, medianHoursToReply: 1 },
      window: { days: 3, from: null, to: null },
      filledForm: {
        count: 1,
        pctOfMessaged: 100,
        alsoWroteBack: 1,
        viaWebForm: 1,
        viaWhatsappForm: 0,
        formsCounted: [],
        allForms: true,
      },
    });
    expect(sentence(s)).toBe(
      'You messaged 1 person. 1 received it, 1 opened it, 1 wrote back within 3 days, and 1 filled in an application form.',
    );
  });

  it('says so when nobody wrote back and nobody filled a form', () => {
    const s = summaryFixture({
      cameBack: { count: 0, pctOfMessaged: 0, pctOfDelivered: 0, medianHoursToReply: null },
      filledForm: {
        count: 0,
        pctOfMessaged: 0,
        alsoWroteBack: 0,
        viaWebForm: 0,
        viaWhatsappForm: 0,
        formsCounted: [],
        allForms: true,
      },
    });
    expect(sentence(s)).toContain('no one has written back within 7 days yet');
    expect(sentence(s)).toContain('no one has filled in an application form yet');
  });

  it('has one sentence when nothing was received, and one when nothing was sent', () => {
    const none = summaryFixture({
      people: { messaged: 0, delivered: 0, read: 0, failed: 0, notTrackable: 0 },
    });
    expect(buildHeadline(none).kind).toBe('none');
    expect(sentence(none)).toBe('No messages have gone out yet.');
    const unread = summaryFixture({
      people: { messaged: 40, delivered: 0, read: 0, failed: 40, notTrackable: 0 },
    });
    expect(buildHeadline(unread).kind).toBe('notReceived');
    expect(sentence(unread)).toBe('You messaged 40 people. No one has received it yet.');
  });

  it('leaves the form part out when the viewer may not read forms', () => {
    const s = summaryFixture({ filledForm: null });
    const h = buildHeadline(s);
    expect(h.clauses.map((c) => c.key)).toEqual(['received', 'opened', 'wroteBack']);
    expect(sentence(s)).not.toContain('form');
    expect(sentence(s)).toBe(
      'You messaged 1,240 people. 1,150 received it, 810 opened it, and 164 wrote back within 7 days.',
    );
  });
});

describe('tiles and funnel', () => {
  it('has five tiles in order, and four without form access', () => {
    expect(buildTiles(summaryFixture()).map((t) => t.key)).toEqual([
      'messaged',
      'received',
      'opened',
      'wroteBack',
      'filledForm',
    ]);
    expect(buildTiles(summaryFixture({ filledForm: null })).map((t) => t.key)).toEqual([
      'messaged',
      'received',
      'opened',
      'wroteBack',
    ]);
  });

  it('puts the same counts in the funnel', () => {
    expect(funnelRows(summaryFixture()).map((r) => r.value)).toEqual([1240, 1150, 810, 164, 31]);
  });
});

describe('caveats as plain sentences', () => {
  it('maps each code to its sentence key, once, with the number of people not matched', () => {
    const s = summaryFixture({
      people: { messaged: 1240, delivered: 1150, read: 810, failed: 90, notTrackable: 12 },
      caveats: [
        'recipients_without_contact',
        'contact_match_only',
        'opted_out_excluded',
        'counted_in_other_campaigns',
        'contact_match_only',
      ],
    });
    const lines = caveatLines(s);
    expect(lines.map((l) => l.key)).toEqual([
      'recipients_without_contact',
      'contact_match_only',
      'opted_out_excluded',
      'counted_in_other_campaigns',
    ]);
    expect(lines[0]!.values.count).toBe(12);
  });

  it('ignores a code a newer API sends', () => {
    const s = summaryFixture({ caveats: ['something_new' as never] });
    expect(caveatLines(s)).toEqual([]);
  });

  it('has a sentence for every code in every message file', () => {
    const t = (
      messages as { campaigns: { detail: { summary: { caveats: Record<string, string> } } } }
    ).campaigns.detail.summary.caveats;
    for (const k of [
      'recipients_without_contact',
      'contact_match_only',
      'opted_out_excluded',
      'counted_in_other_campaigns',
    ]) {
      expect(t[k]).toBeTruthy();
    }
  });
});

describe('states and tabs', () => {
  it('knows nothing was sent', () => {
    expect(isNotSent(summaryFixture())).toBe(false);
    expect(
      isNotSent(
        summaryFixture({
          people: { messaged: 0, delivered: 0, read: 0, failed: 0, notTrackable: 0 },
        }),
      ),
    ).toBe(true);
  });

  it('opens a finished campaign on the Summary and a live one on the Overview', () => {
    expect(defaultTab('completed')).toBe('summary');
    expect(defaultTab('cancelled')).toBe('summary');
    expect(defaultTab('running')).toBe('overview');
    expect(defaultTab('scheduled')).toBe('overview');
    expect(isStillSending('running')).toBe(true);
    expect(isStillSending('completed')).toBe(false);
  });

  it('finds the busiest day, or none', () => {
    expect(busiestDay(summaryFixture().cameBackByDay)).toEqual({ day: '2026-10-02', count: 90 });
    expect(busiestDay([{ day: '2026-10-01', count: 0 }])).toBeNull();
    expect(busiestDay([])).toBeNull();
  });
});

describe('the names file', () => {
  it('neutralises a cell a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+919000000001')).toBe("'+919000000001");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });

  it('quotes commas, quotes and line breaks, and writes nothing for empty', () => {
    expect(csvCell('Asha, Rao')).toBe('"Asha, Rao"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell(null)).toBe('');
    expect(csvCell('')).toBe('');
    expect(csvCell('Plain Name')).toBe('Plain Name');
  });

  it('writes a header, the list of each row, a byte order mark and CRLF lines', () => {
    const csv = peopleCsv(
      [
        {
          kind: 'came_back',
          rows: [
            {
              contactId: null,
              name: '=cmd|x',
              phone: '+911',
              at: '2026-10-02T10:00:00.000Z',
              formName: null,
            },
          ],
        },
        {
          kind: 'filled_form',
          rows: [
            { contactId: null, name: 'Meera', phone: null, at: null, formName: 'Apply, 2026' },
          ],
        },
      ],
      {
        headers: { group: 'List', name: 'Name', phone: 'Phone', when: 'When', form: 'Form' },
        group: {
          came_back: 'Wrote back',
          filled_form: 'Filled a form',
          not_reached: 'Not reached',
        },
      },
    );
    expect(csv.startsWith(BYTE_ORDER_MARK)).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'List,Name,Phone,When,Form',
      "Wrote back,'=cmd|x,'+911,2026-10-02T10:00:00.000Z,",
      'Filled a form,Meera,,,"Apply, 2026"',
      '',
    ]);
  });

  it('names the file after the campaign in any script', () => {
    expect(csvFileName('Open day 2026')).toBe('Open-day-2026-names.csv');
    expect(csvFileName('खुला दिन / प्रवेश')).toBe('खुला-दिन-प्रवेश-names.csv');
    expect(csvFileName('///')).toBe('campaign-names.csv');
  });
});
