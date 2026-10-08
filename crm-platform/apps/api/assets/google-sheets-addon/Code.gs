/**
 * CRM add-on for Google Sheets (server side).
 *
 * A custom menu in the sheet, a settings dialog for the member's personal key, and four actions: check the connection, pull contacts
 * into a sheet, push contacts from a sheet, and sync products to a storefront shop. Every call goes to the CRM's add-on API at
 * CRM_BASE + '/api/v1/sheets-addon' with `Authorization: Bearer <key>`.
 *
 * The key lives only in the member's own user properties. It is never written to the sheet, never to the document properties (a sheet
 * can be shared), never to a log, and it is never sent back to the dialogs: they only ever see a masked copy.
 */

// The download of this file rewrites the next line to this installation's address. Keep it on one line.
const CRM_BASE = 'https://api.example.com';

const API_PATH = '/api/v1/sheets-addon';
const MENU_TITLE = 'CRM';
const KEY_PREFIX = 'wsn_live_';
const KEY_PATTERN = /^wsn_live_[0-9a-f]{32}$/;
const PROP_KEY = 'CRM_SHEETS_KEY';
const PROP_CAN = 'CRM_SHEETS_CAN';
const PROP_SHOP_ID = 'CRM_SHOP_ID';
const PROP_SHOP_NAME = 'CRM_SHOP_NAME';
const MAX_ROWS = 500;
const PULL_PAGE = 500;
const PULL_MAX_PAGES = 100;
const PULL_SHEET = 'CRM contacts';
const STATUS_HEADER = 'CRM status';
const MAX_AUTO_WAIT_SECONDS = 20;
const MAX_RETRIES = 2;

const CONTACT_FIELDS = {
  name: ['name', 'fullname', 'contactname'],
  first_name: ['firstname', 'first'],
  last_name: ['lastname', 'last', 'surname'],
  email: ['email', 'emailaddress', 'mail'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'whatsapp', 'whatsappnumber'],
  country_code: ['countrycode', 'dialcode'],
  source: ['source'],
  is_unsubscribed: ['isunsubscribed', 'unsubscribed', 'optedout'],
};

const PRODUCT_FIELDS = {
  name: ['name', 'productname', 'title'],
  category: ['category'],
  description: ['description'],
  image_url: ['imageurl', 'image', 'imageaddress'],
  price: ['price'],
  sku: ['sku'],
  stock: ['stock', 'quantity', 'inventory'],
  active: ['active', 'enabled', 'published'],
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Menu and dialogs
// ---------------------------------------------------------------------------------------------------------------------------------

function onOpen() {
  buildMenu_(readCan_());
}

function onInstall() {
  onOpen();
}

/** Builds the menu. `can` is what the last connection check said the key may do (null = not checked yet: show everything). */
function buildMenu_(can) {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu(MENU_TITLE);
  menu.addItem('Check connection', 'checkConnectionMenu');
  const allowed = function (flag) {
    return !can || can[flag] === true;
  };
  let groups = 0;
  if (allowed('read_contacts') || allowed('write_contacts')) {
    menu.addSeparator();
    if (allowed('read_contacts')) menu.addItem('Pull contacts into a sheet', 'openPull');
    if (allowed('write_contacts')) menu.addItem('Push contacts from this sheet', 'openPush');
    groups++;
  }
  if (allowed('write_catalog')) {
    menu.addSeparator();
    menu.addItem('Sync products to a shop', 'openProducts');
    groups++;
  }
  menu.addSeparator();
  menu.addItem('Settings', 'openSettings');
  menu.addItem('Help', 'openHelp');
  menu.addToUi();
  return groups;
}

function openSettings() {
  showDialog_('Settings', 'Settings', 460, 420);
}

function openHelp() {
  showDialog_('Help', 'Help', 520, 520);
}

function openPull() {
  showDialog_('Dialog', 'Pull contacts', 520, 440, 'pull');
}

function openPush() {
  showDialog_('Dialog', 'Push contacts', 520, 480, 'push');
}

function openProducts() {
  showDialog_('Dialog', 'Sync products to a shop', 520, 560, 'products');
}

function showDialog_(file, title, width, height, mode) {
  const template = HtmlService.createTemplateFromFile(file);
  template.mode = mode || '';
  const html = template.evaluate().setWidth(width).setHeight(height);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

function checkConnectionMenu() {
  const ui = SpreadsheetApp.getUi();
  const result = checkConnection();
  if (!result.ok) {
    ui.alert('CRM connection', result.message, ui.ButtonSet.OK);
    return;
  }
  ui.alert('CRM connection', describeConnection_(result), ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Key storage (the member's own user properties; nothing here ever logs or returns the secret)
// ---------------------------------------------------------------------------------------------------------------------------------

function userProps_() {
  return PropertiesService.getUserProperties();
}

function docProps_() {
  return PropertiesService.getDocumentProperties();
}

function readKey_() {
  return userProps_().getProperty(PROP_KEY) || '';
}

function readCan_() {
  try {
    const raw = userProps_().getProperty(PROP_CAN);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function isValidKey_(value) {
  return typeof value === 'string' && KEY_PATTERN.test(value.trim());
}

/** `wsn_live_••••••••89abcdef`: the prefix and the last 8 characters, nothing else. Empty text for no key. */
function maskKey_(value) {
  if (typeof value !== 'string' || value.length < KEY_PREFIX.length + 8) return '';
  return KEY_PREFIX + '••••••••' + value.slice(-8);
}

/** What Settings may show: whether a key is saved and its masked form. */
function getSettingsState() {
  const key = readKey_();
  return {
    hasKey: key !== '',
    masked: maskKey_(key),
    can: readCan_(),
    base: CRM_BASE,
  };
}

/** Saves the pasted key after a connection check proves it works. A key that fails is not kept. */
function saveKey(pasted) {
  const candidate = typeof pasted === 'string' ? pasted.trim() : '';
  if (candidate === '') {
    return failure_('EXT_KEY_MISSING', 0, 'Paste your key first.');
  }
  if (!isValidKey_(candidate)) {
    return failure_(
      'EXT_KEY_INVALID',
      0,
      'This does not look like a key. It starts with ' +
        KEY_PREFIX +
        ' and has 32 more characters.',
    );
  }
  const props = userProps_();
  const previous = props.getProperty(PROP_KEY);
  props.setProperty(PROP_KEY, candidate);
  const result = checkConnection();
  if (!result.ok) {
    if (previous) props.setProperty(PROP_KEY, previous);
    else props.deleteProperty(PROP_KEY);
    return result;
  }
  return result;
}

/** Removes the key and what was learned with it from this member's properties. */
function clearKey() {
  const props = userProps_();
  props.deleteProperty(PROP_KEY);
  props.deleteProperty(PROP_CAN);
  try {
    buildMenu_(null);
  } catch (e) {
    // the menu is rebuilt from the saved answer the next time the sheet opens
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// HTTP: one place that talks to the API, reads the JSON body of every answer and turns failures into readable messages
// ---------------------------------------------------------------------------------------------------------------------------------

function failure_(code, status, message, extra) {
  const out = { ok: false, code: code, status: status, message: message };
  if (extra) {
    for (const name in extra) out[name] = extra[name];
  }
  return out;
}

/** The sentence a member reads for a failed call. The server's own sentence wins; a hint is added where the member can act. */
function describeFailure_(status, code, serverMessage, retryAfter) {
  const base = serverMessage || 'The CRM could not complete the request.';
  switch (code) {
    case 'EXT_KEY_MISSING':
      return 'No key is saved yet. Open CRM > Settings and paste your key.';
    case 'EXT_KEY_INVALID':
      return 'The key is not valid any more. Create a new one in the CRM (Settings > Google Sheets add-on), then paste it in CRM > Settings.';
    case 'EXT_APP_NOT_INSTALLED':
      return 'The Google Sheets add-on is not installed in this workspace. Ask an admin to install it from the Marketplace.';
    case 'EXT_SCOPE_NOT_GRANTED':
      return base + ' Ask an admin to reinstall the add-on and accept its permissions.';
    case 'PAYLOAD_TOO_LARGE':
      return 'The request was too large. Send fewer rows at a time.';
    default:
      break;
  }
  if (status === 413) return 'The request was too large. Send fewer rows at a time.';
  if (status === 429 || code === 'RATE_LIMITED') {
    return retryAfter
      ? 'Too many requests. Wait ' + retryAfter + ' seconds and try again.'
      : 'Too many requests. Wait a minute and try again.';
  }
  return base;
}

/** Whole seconds from a Retry-After header value, or 0. */
function parseRetryAfter_(value) {
  const n = parseInt(String(value === undefined || value === null ? '' : value).trim(), 10);
  return isFinite(n) && n > 0 ? n : 0;
}

function headerValue_(headers, name) {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  for (const h in headers) {
    if (h.toLowerCase() === wanted) return headers[h];
  }
  return '';
}

function buildQuery_(query) {
  if (!query) return '';
  const parts = [];
  for (const name in query) {
    const value = query[name];
    if (value === undefined || value === null || value === '') continue;
    parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** Turns a raw answer (status, body text, headers) into { ok:true, data } or a failure. Pure: no network. */
function interpretResponse_(status, text, headers) {
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = null;
  }
  if (status === 200 && json && json.ok === true) {
    return { ok: true, status: status, data: json };
  }
  const retryAfter = parseRetryAfter_(headerValue_(headers, 'Retry-After'));
  const code = json && typeof json.code === 'string' ? json.code : 'HTTP_' + status;
  const serverMessage = json && typeof json.error === 'string' ? json.error : '';
  return failure_(code, status, describeFailure_(status, code, serverMessage, retryAfter), {
    details: json && json.details ? json.details : null,
    requestId: json && json.requestId ? json.requestId : null,
    retryAfter: retryAfter,
  });
}

/** One API call with up to two short waits when the answer is 429 with a small Retry-After. */
function callApi_(method, path, query, body) {
  const key = readKey_();
  if (!key) return failure_('EXT_KEY_MISSING', 0, describeFailure_(0, 'EXT_KEY_MISSING', '', 0));
  const options = {
    method: method,
    muteHttpExceptions: true,
    followRedirects: false,
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
  };
  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const url = CRM_BASE.replace(/\/+$/, '') + API_PATH + path + buildQuery_(query);
  let attempt = 0;
  for (;;) {
    let result;
    try {
      const response = UrlFetchApp.fetch(url, options);
      result = interpretResponse_(
        response.getResponseCode(),
        response.getContentText(),
        response.getHeaders(),
      );
    } catch (e) {
      return failure_(
        'NETWORK',
        0,
        'Could not reach the CRM at ' + CRM_BASE + '. Check your connection and try again.',
      );
    }
    if (result.ok || result.status !== 429) return result;
    if (attempt >= MAX_RETRIES || !result.retryAfter || result.retryAfter > MAX_AUTO_WAIT_SECONDS) {
      return result;
    }
    attempt++;
    Utilities.sleep(result.retryAfter * 1000);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Check connection
// ---------------------------------------------------------------------------------------------------------------------------------

function checkConnection() {
  const result = callApi_('get', '/health');
  if (!result.ok) return result;
  const health = result.data;
  const can = health.can || {};
  userProps_().setProperty(PROP_CAN, JSON.stringify(can));
  try {
    buildMenu_(can);
  } catch (e) {
    // the menu cannot be rebuilt from every context; the next time the sheet opens it is built from the saved answer
  }
  return {
    ok: true,
    user: health.user || {},
    workspace: health.workspace || {},
    can: can,
    limits: health.limits || { max_rows: MAX_ROWS, max_pull: PULL_PAGE },
    masked: maskKey_(readKey_()),
  };
}

function describeConnection_(info) {
  const lines = [];
  lines.push(
    'Connected as ' + (info.user.name || 'a member') + ' (' + (info.user.email || '') + ').',
  );
  lines.push('Workspace: ' + (info.workspace.name || ''));
  lines.push('');
  lines.push('This key can:');
  lines.push((info.can.read_contacts ? '  [x] ' : '  [ ] ') + 'pull contacts');
  lines.push((info.can.write_contacts ? '  [x] ' : '  [ ] ') + 'push contacts');
  lines.push((info.can.read_catalog ? '  [x] ' : '  [ ] ') + 'see shops');
  lines.push((info.can.write_catalog ? '  [x] ' : '  [ ] ') + 'sync products');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sheet helpers (pure where possible, so they can be tested without Google)
// ---------------------------------------------------------------------------------------------------------------------------------

/** "First name", "first_name" and "FIRST-NAME" all become "firstname". */
function normalizeHeader_(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Maps the header row to fields. `fields` is { field: [aliases] }. Returns { columns: { field: index }, attributes: { key: index },
 * status: index or -1 }. The first column that matches a field wins. A header written `attr:city` or `attributes.city` is the custom
 * contact property `city`.
 */
function mapHeaders_(headers, fields, allowAttributes) {
  const columns = {};
  const attributes = {};
  let status = -1;
  for (let i = 0; i < headers.length; i++) {
    const raw = String(headers[i] === undefined || headers[i] === null ? '' : headers[i]).trim();
    if (raw === '') continue;
    const normal = normalizeHeader_(raw);
    if (normal === 'crmstatus') {
      if (status < 0) status = i;
      continue;
    }
    const attr = /^(?:attr:|attributes\.)\s*(.+)$/i.exec(raw);
    if (allowAttributes && attr) {
      const attrKey = attr[1].trim();
      if (attrKey !== '' && attributes[attrKey] === undefined) attributes[attrKey] = i;
      continue;
    }
    for (const field in fields) {
      if (columns[field] === undefined && fields[field].indexOf(normal) !== -1) {
        columns[field] = i;
        break;
      }
    }
  }
  return { columns: columns, attributes: attributes, status: status };
}

function isBlank_(value) {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

/** A cell as JSON: dates become ISO text, everything else is passed as it is. Blank cells are returned as ''. */
function cellValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]')
    return isNaN(value.getTime()) ? '' : value.toISOString();
  if (value === undefined || value === null) return '';
  return value;
}

/**
 * Turns the sheet's rows (2D values, row 1 = headers) into API rows. `kind` is 'contacts' or 'products'. Fully blank rows are skipped.
 * Returns { rows, mapping, problem }: `problem` is a sentence when the headers cannot work, else ''.
 */
function rowsFromValues_(values, kind) {
  if (!values || values.length < 1) {
    return {
      rows: [],
      mapping: null,
      problem: 'The sheet is empty. Put the column names in row 1.',
    };
  }
  const contacts = kind === 'contacts';
  const mapping = mapHeaders_(values[0], contacts ? CONTACT_FIELDS : PRODUCT_FIELDS, contacts);
  const columns = mapping.columns;
  if (contacts && columns.email === undefined && columns.phone === undefined) {
    return {
      rows: [],
      mapping: mapping,
      problem: 'Row 1 needs a column named email or phone.',
    };
  }
  if (!contacts && (columns.name === undefined || columns.price === undefined)) {
    return {
      rows: [],
      mapping: mapping,
      problem: 'Row 1 needs columns named name and price.',
    };
  }
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const line = values[r];
    let empty = true;
    for (let c = 0; c < line.length; c++) {
      if (!isBlank_(line[c])) {
        empty = false;
        break;
      }
    }
    if (empty) continue;
    const row = { ref: r + 1 };
    for (const field in columns) {
      const value = cellValue_(line[columns[field]]);
      // A blank contact cell means "not given" and is left out. A product's stock keeps its blank, which means unlimited.
      if (isBlank_(value) && !(kind === 'products' && field === 'stock')) continue;
      row[field] = value;
    }
    if (contacts) {
      const attrs = {};
      let any = false;
      for (const attrKey in mapping.attributes) {
        const value = cellValue_(line[mapping.attributes[attrKey]]);
        if (isBlank_(value)) continue;
        attrs[attrKey] = value;
        any = true;
      }
      if (any) row.attributes = attrs;
    }
    rows.push(row);
  }
  return { rows: rows, mapping: mapping, problem: '' };
}

function chunk_(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The text written in the status column for one row result. */
function statusText_(result) {
  if (!result) return 'no result returned';
  if (result.status !== 'failed') return result.status;
  const error = result.error || {};
  const where = error.field ? error.field + ': ' : '';
  return 'failed: ' + where + (error.message || error.code || 'unknown error');
}

function emptyTotals_() {
  return { created: 0, updated: 0, unchanged: 0, failed: 0, notSent: 0 };
}

/**
 * Adds one answer's per-row results to the totals and returns the status text for every sent row, keyed by sheet row. The totals are
 * counted from the results (not from the summary) so that a row the server did not mention is not silently counted as done.
 */
function applyResults_(totals, sentRows, results) {
  const byIndex = {};
  const list = results || [];
  for (let i = 0; i < list.length; i++) byIndex[list[i].index] = list[i];
  const texts = {};
  const problems = [];
  for (let i = 0; i < sentRows.length; i++) {
    const result = byIndex[i];
    const row = sentRows[i].ref;
    texts[row] = statusText_(result);
    if (!result) {
      totals.failed++;
    } else if (result.status === 'created') totals.created++;
    else if (result.status === 'updated') totals.updated++;
    else if (result.status === 'unchanged') totals.unchanged++;
    else {
      totals.failed++;
      problems.push('Row ' + row + ': ' + texts[row].replace(/^failed: /, ''));
    }
  }
  return { texts: texts, problems: problems };
}

/** Finds the CRM status column, or adds one after the last used column. Returns the 0-based index. */
function ensureStatusColumn_(sheet, mapping) {
  if (mapping.status >= 0) return mapping.status;
  const index = Math.max(sheet.getLastColumn(), 1);
  sheet.getRange(1, index + 1).setValue(STATUS_HEADER);
  return index;
}

/** Writes a status text for each given sheet row number into the status column (0-based `statusIndex`), in one read and one write. */
function writeStatuses_(sheet, statusIndex, texts) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, statusIndex + 1, lastRow - 1, 1);
  const column = range.getValues();
  for (const row in texts) {
    const at = Number(row) - 2;
    if (at >= 0 && at < column.length) column[at][0] = texts[row];
  }
  range.setValues(column);
}

function writeStatusBlock_(sheet, statusIndex, rowNumbers, text) {
  const map = {};
  for (let i = 0; i < rowNumbers.length; i++) map[rowNumbers[i]] = text;
  writeStatuses_(sheet, statusIndex, map);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pull contacts
// ---------------------------------------------------------------------------------------------------------------------------------

/** What a dialog needs to open: whether a key is saved and what it may do. */
function getDialogState() {
  const key = readKey_();
  const state = {
    hasKey: key !== '',
    can: readCan_(),
    masked: maskKey_(key),
    shopId: '',
    shopName: '',
  };
  const props = docProps_();
  state.shopId = props.getProperty(PROP_SHOP_ID) || '';
  state.shopName = props.getProperty(PROP_SHOP_NAME) || '';
  state.sheetName = SpreadsheetApp.getActiveSheet().getName();
  state.pullSheet = PULL_SHEET;
  return state;
}

function contactColumns_(contacts) {
  const attributeKeys = [];
  const seen = {};
  for (let i = 0; i < contacts.length; i++) {
    const attrs = contacts[i].attributes || {};
    for (const name in attrs) {
      if (!seen[name]) {
        seen[name] = true;
        attributeKeys.push(name);
      }
    }
  }
  attributeKeys.sort();
  return attributeKeys;
}

/** One contact as a sheet line: the fixed columns, then one `attr:<key>` column for each custom property. */
function contactLine_(contact, attributeKeys) {
  const line = [
    contact.id || '',
    contact.name || '',
    contact.first_name || '',
    contact.last_name || '',
    contact.email || '',
    contact.phone || '',
    contact.source || '',
    contact.is_unsubscribed === true ? 'yes' : 'no',
    contact.created_at || '',
    contact.updated_at || '',
  ];
  const attrs = contact.attributes || {};
  for (let i = 0; i < attributeKeys.length; i++) {
    const value = attrs[attributeKeys[i]];
    line.push(
      value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : value,
    );
  }
  return line;
}

function runPull(options) {
  const search = options && typeof options.q === 'string' ? options.q.trim() : '';
  const contacts = [];
  let cursor = '';
  let pages = 0;
  let more = false;
  for (;;) {
    const result = callApi_('get', '/contacts', { limit: PULL_PAGE, cursor: cursor, q: search });
    if (!result.ok) {
      if (contacts.length === 0) return result;
      return failure_(
        result.code,
        result.status,
        'Stopped after ' + contacts.length + ' contacts. ' + result.message,
        {
          pulled: contacts.length,
        },
      );
    }
    const page = result.data;
    const list = page.contacts || [];
    for (let i = 0; i < list.length; i++) contacts.push(list[i]);
    pages++;
    more = page.has_more === true && !!page.next_cursor;
    if (!more) break;
    if (pages >= PULL_MAX_PAGES) break;
    cursor = page.next_cursor;
  }
  const attributeKeys = contactColumns_(contacts);
  const headers = [
    'id',
    'name',
    'first_name',
    'last_name',
    'email',
    'phone',
    'source',
    'is_unsubscribed',
    'created_at',
    'updated_at',
  ].concat(
    attributeKeys.map(function (k) {
      return 'attr:' + k;
    }),
  );
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(PULL_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(PULL_SHEET);
  sheet.clear();
  const lines = [headers].concat(
    contacts.map(function (c) {
      return contactLine_(c, attributeKeys);
    }),
  );
  sheet.getRange(1, 1, lines.length, headers.length).setValues(lines);
  sheet.setFrozenRows(1);
  spreadsheet.setActiveSheet(sheet);
  return {
    ok: true,
    pulled: contacts.length,
    sheet: PULL_SHEET,
    truncated: more,
    message: contacts.length === 0 ? 'No contacts matched.' : '',
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Push contacts
// ---------------------------------------------------------------------------------------------------------------------------------

function runPush(options) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return failure_(
      'EMPTY_SHEET',
      0,
      'There are no rows to send. Row 1 is the header row; the contacts start in row 2.',
    );
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const read = rowsFromValues_(values, 'contacts');
  if (read.problem) return failure_('BAD_HEADERS', 0, read.problem);
  if (read.rows.length === 0) return failure_('EMPTY_SHEET', 0, 'There are no rows to send.');

  const countryCode =
    options && typeof options.countryCode === 'string' ? options.countryCode.trim() : '';
  const statusIndex = ensureStatusColumn_(sheet, read.mapping);
  const totals = emptyTotals_();
  const problems = [];
  let stopped = null;
  const chunks = chunk_(read.rows, MAX_ROWS);
  for (let c = 0; c < chunks.length; c++) {
    const sent = chunks[c];
    const body = { rows: sent };
    if (countryCode !== '') body.default_country_code = countryCode;
    const result = callApi_('post', '/contacts/sync', undefined, body);
    if (!result.ok) {
      stopped = result;
      const unsent = [];
      for (let k = c; k < chunks.length; k++) {
        for (let j = 0; j < chunks[k].length; j++) unsent.push(chunks[k][j].ref);
      }
      totals.notSent += unsent.length;
      writeStatusBlock_(sheet, statusIndex, unsent, 'not sent: ' + result.message);
      break;
    }
    const applied = applyResults_(totals, sent, result.data.results);
    writeStatuses_(sheet, statusIndex, applied.texts);
    for (let p = 0; p < applied.problems.length && problems.length < 10; p++)
      problems.push(applied.problems[p]);
    SpreadsheetApp.flush();
  }
  return summaryReply_(totals, problems, stopped, {
    rows: read.rows.length,
    statusColumn: STATUS_HEADER,
  });
}

function summaryReply_(totals, problems, stopped, extra) {
  const reply = {
    ok: stopped === null,
    created: totals.created,
    updated: totals.updated,
    unchanged: totals.unchanged,
    failed: totals.failed,
    notSent: totals.notSent,
    problems: problems,
    rows: extra.rows,
    statusColumn: extra.statusColumn,
  };
  if (stopped) {
    reply.code = stopped.code;
    reply.status = stopped.status;
    reply.message = stopped.message;
    reply.details = stopped.details || null;
    reply.requestId = stopped.requestId || null;
  }
  return reply;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sync products to a shop
// ---------------------------------------------------------------------------------------------------------------------------------

/** The shops the member's workspace has, for the dialog's picker. */
function listShops() {
  const result = callApi_('get', '/shops');
  if (!result.ok) return result;
  const shops = (result.data.shops || []).map(function (shop) {
    return {
      id: shop.id,
      name: shop.shop_name || shop.slug,
      currency: shop.currency,
      url: shop.public_url,
    };
  });
  const props = docProps_();
  return {
    ok: true,
    shops: shops,
    shopId: props.getProperty(PROP_SHOP_ID) || '',
    shopName: props.getProperty(PROP_SHOP_NAME) || '',
  };
}

function validShopOptions_(options) {
  const name = options && typeof options.shopName === 'string' ? options.shopName.trim() : '';
  const currency = options && typeof options.currency === 'string' ? options.currency.trim() : '';
  const description =
    options && typeof options.description === 'string' ? options.description.trim() : '';
  const errors = {};
  if (name === '') errors.shopName = 'Give the shop a name.';
  else if (name.length > 191) errors.shopName = 'The shop name is at most 191 characters.';
  if (currency !== '' && !/^[A-Za-z]{3}$/.test(currency))
    errors.currency = 'Use a 3-letter currency code such as INR or USD.';
  if (description.length > 2000) errors.description = 'The description is at most 2000 characters.';
  return { errors: errors, name: name, currency: currency.toUpperCase(), description: description };
}

function runProductSync(options) {
  const valid = validShopOptions_(options);
  if (Object.keys(valid.errors).length > 0) {
    return failure_('VALIDATION_FAILED', 0, 'Check the form and try again.', {
      fieldErrors: valid.errors,
    });
  }
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return failure_(
      'EMPTY_SHEET',
      0,
      'There are no products to send. Row 1 is the header row; the products start in row 2.',
    );
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const read = rowsFromValues_(values, 'products');
  if (read.problem) return failure_('BAD_HEADERS', 0, read.problem);
  if (read.rows.length === 0) return failure_('EMPTY_SHEET', 0, 'There are no products to send.');

  const props = docProps_();
  let shopId =
    options && typeof options.shopId === 'string' && options.shopId !== '' ? options.shopId : '';
  if (options && options.newShop === true) shopId = '';
  const statusIndex = ensureStatusColumn_(sheet, read.mapping);
  const totals = emptyTotals_();
  const problems = [];
  let stopped = null;
  let shop = null;
  const chunks = chunk_(read.rows, MAX_ROWS);
  for (let c = 0; c < chunks.length; c++) {
    const sent = chunks[c];
    const body = { shop_name: valid.name, products: sent };
    if (shopId !== '') body.shop_id = shopId;
    if (valid.currency !== '') body.currency = valid.currency;
    if (valid.description !== '') body.description = valid.description;
    const result = callApi_('post', '/sync', undefined, body);
    if (!result.ok) {
      stopped = result;
      const unsent = [];
      for (let k = c; k < chunks.length; k++) {
        for (let j = 0; j < chunks[k].length; j++) unsent.push(chunks[k][j].ref);
      }
      totals.notSent += unsent.length;
      writeStatusBlock_(sheet, statusIndex, unsent, 'not sent: ' + result.message);
      break;
    }
    const answer = result.data;
    if (answer.shop && answer.shop.id) {
      // The shop is saved first and a failing batch does not undo it, so keep its id for every later sync (and later chunks).
      shopId = answer.shop.id;
      shop = answer.shop;
      props.setProperty(PROP_SHOP_ID, shopId);
      props.setProperty(PROP_SHOP_NAME, answer.shop.shop_name || valid.name);
    }
    const applied = applyResults_(totals, sent, answer.products ? answer.products.results : []);
    writeStatuses_(sheet, statusIndex, applied.texts);
    for (let p = 0; p < applied.problems.length && problems.length < 10; p++)
      problems.push(applied.problems[p]);
    SpreadsheetApp.flush();
  }
  const reply = summaryReply_(totals, problems, stopped, {
    rows: read.rows.length,
    statusColumn: STATUS_HEADER,
  });
  if (shop) {
    reply.shop = {
      id: shop.id,
      name: shop.shop_name || valid.name,
      url: shop.public_url || '',
      created: shop.created === true,
    };
  }
  return reply;
}

/** Forgets the shop this document syncs to, so the next sync can create or pick another. */
function forgetShop() {
  const props = docProps_();
  props.deleteProperty(PROP_SHOP_ID);
  props.deleteProperty(PROP_SHOP_NAME);
  return { ok: true };
}
