import {
  GoogleNotConnectedError,
  type DocGenerate,
  type GoogleAccessTokens,
  type GoogleWorkspacePort,
  type MeetCreate,
  type SheetAppend,
  type SheetRead,
} from './google-workspace.port';

const TIMEOUT_MS = 15_000;
const enc = encodeURIComponent;

/** Google's own hosts only: every id is encoded into a fixed URL, so nothing a flow author typed picks the host. */
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DOCS = 'https://docs.googleapis.com/v1/documents';
const FORMS = 'https://forms.googleapis.com/v1/forms';
const CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** A1 range for a tab: the quoted tab name, or the first tab when none is named. */
const tabRange = (tab: string, cells = ''): string =>
  tab === ''
    ? cells === ''
      ? 'A1'
      : cells
    : `'${tab.replace(/'/g, "''")}'${cells ? `!${cells}` : ''}`;

const norm = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .toLowerCase();

/**
 * The Google REST APIs behind `GoogleWorkspacePort`, called with the workspace's access token from `GoogleAccessTokens`. Where the token
 * comes from (OAuth settings, a service account) is another domain's concern; with none stored every call fails with
 * `GoogleNotConnectedError`, the Reference "no Google account connected" outcome.
 */
export class HttpGoogleWorkspace implements GoogleWorkspacePort {
  constructor(
    private readonly tokens: GoogleAccessTokens,
    private readonly http: typeof fetch = fetch,
  ) {}

  private async call<T>(orgId: number, url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.tokens.accessToken(orgId);
    if (!token) throw new GoogleNotConnectedError();
    const res = await this.http(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Google answered HTTP ${res.status}: ${text.slice(0, 200)}`);
    return (text === '' ? {} : JSON.parse(text)) as T;
  }

  private async headerRow(orgId: number, sheetId: string, tab: string): Promise<string[]> {
    const r = await this.call<{ values?: string[][] }>(
      orgId,
      `${SHEETS}/${enc(sheetId)}/values/${enc(tabRange(tab, '1:1'))}`,
    );
    return (r.values?.[0] ?? []).map(String);
  }

  async appendSheetRow(orgId: number, req: SheetAppend): Promise<void> {
    let values = req.values;
    if (req.matchByHeader && req.columnHeaders.length > 0) {
      const sheet = await this.headerRow(orgId, req.sheetId, req.tabName);
      if (sheet.length > 0) values = placeUnderHeaders(sheet, req.columnHeaders, req.values);
    }
    await this.call(
      orgId,
      `${SHEETS}/${enc(req.sheetId)}/values/${enc(tabRange(req.tabName))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: [values] }) },
    );
  }

  async readSheetRows(orgId: number, req: SheetRead): Promise<Array<Record<string, string>>> {
    const r = await this.call<{ values?: string[][] }>(
      orgId,
      `${SHEETS}/${enc(req.sheetId)}/values/${enc(tabRange(req.tabName, 'A:ZZ'))}`,
    );
    const [headers = [], ...body] = r.values ?? [];
    const rows: Array<Record<string, string>> = [];
    const col =
      req.matchColumn === '' ? -1 : headers.findIndex((h) => norm(h) === norm(req.matchColumn));
    if (req.matchColumn !== '' && col < 0) return rows;
    for (const cells of body) {
      if (col >= 0 && norm(cells[col]) !== norm(req.matchValue)) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (String(h).trim() !== '') row[String(h)] = String(cells[i] ?? '');
      });
      rows.push(row);
      if (rows.length >= req.limit) break;
    }
    return rows;
  }

  async generateDoc(orgId: number, req: DocGenerate): Promise<{ url: string }> {
    const copy = await this.call<{ id: string }>(orgId, `${DRIVE}/${enc(req.templateId)}/copy`, {
      method: 'POST',
      body: JSON.stringify({ name: req.newTitle }),
    });
    const requests = Object.entries(req.vars).map(([key, value]) => ({
      replaceAllText: {
        containsText: { text: `{{${key}}}`, matchCase: false },
        replaceText: value,
      },
    }));
    if (requests.length > 0) {
      await this.call(orgId, `${DOCS}/${enc(copy.id)}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests }),
      });
    }
    if (req.shareable) {
      await this.call(orgId, `${DRIVE}/${enc(copy.id)}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ type: 'anyone', role: 'reader' }),
      });
    }
    return { url: `https://docs.google.com/document/d/${copy.id}/edit` };
  }

  async formResponderUrl(orgId: number, formId: string): Promise<{ url: string }> {
    const f = await this.call<{ responderUri?: string }>(orgId, `${FORMS}/${enc(formId)}`);
    if (!f.responderUri) throw new Error('The form has no responder link');
    return { url: f.responderUri };
  }

  async createMeet(orgId: number, req: MeetCreate): Promise<{ meetUrl: string; eventId: string }> {
    const e = await this.call<{ id?: string; hangoutLink?: string }>(
      orgId,
      `${CALENDAR}?conferenceDataVersion=1&sendUpdates=${req.sendInvites ? 'all' : 'none'}`,
      {
        method: 'POST',
        body: JSON.stringify({
          summary: req.title,
          start: { dateTime: req.startAt.toISOString(), timeZone: req.timeZone },
          end: { dateTime: req.endAt.toISOString(), timeZone: req.timeZone },
          conferenceData: {
            createRequest: {
              requestId: req.requestId,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }),
      },
    );
    if (!e.hangoutLink) throw new Error('Google created the event without a Meet link');
    return { meetUrl: e.hangoutLink, eventId: e.id ?? '' };
  }
}

/**
 * Values under the sheet column whose header matches each label (case-insensitive, trimmed). A label the sheet lacks goes after the last
 * column so nothing is dropped (Reference's `match_by_header`).
 */
export function placeUnderHeaders(sheet: string[], labels: string[], values: string[]): string[] {
  const index = new Map<string, number>();
  sheet.forEach((h, i) => {
    const k = norm(h);
    if (k !== '' && !index.has(k)) index.set(k, i);
  });
  const row = sheet.map(() => '');
  const extra: string[] = [];
  labels.forEach((label, j) => {
    const v = values[j] ?? '';
    const at = index.get(norm(label));
    if (at !== undefined) row[at] = v;
    else if (v !== '' || label.trim() !== '') extra.push(v);
  });
  return [...row, ...extra];
}
