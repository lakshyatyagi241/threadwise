/**
 * Paste into the Google Sheet: Extensions > Apps Script. Then Project Settings > Script properties, add:
 *   TOKEN      a long random string (the same value goes in QA_SHEET_TOKEN on every machine)
 *   FOLDER_ID  id of a Drive folder that will hold the screenshots (the part after /folders/ in its URL)
 * Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone. Copy the /exec URL into QA_SHEET_URL.
 * Anyone with the URL still needs TOKEN; every call is rejected without it.
 */
/* Statuses: Open, In progress, Fix PR open, Fixed (merged, awaiting verification), Verified (legacy: Done), Needs human. */
var HEADERS = ['ID', 'Date', 'Page', 'Severity', 'Type', 'Bug', 'Description', 'Suggested fix',
  'Screenshot', 'Screenshot link', 'Status', 'Owner', 'Note', 'Updated',
  'Env', 'Area', 'Test', 'Fix PR', 'After screenshot', 'After link', 'Verified on', 'Attempts'];
var COL = {};
HEADERS.forEach(function (h, i) { COL[h] = i; });
var RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Bugs') || ss.insertSheet('Bugs');
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setColumnWidth(COL.Screenshot + 1, 260);
    sh.setColumnWidth(COL['After screenshot'] + 1, 260);
  } else {
    // v1 sheet: add the v2 columns at the end, keep every existing row as it is
    var have = sh.getLastColumn();
    if (have < HEADERS.length) {
      sh.getRange(1, have + 1, 1, HEADERS.length - have).setValues([HEADERS.slice(have)]).setFontWeight('bold');
      sh.setColumnWidth(COL['After screenshot'] + 1, 260);
    }
  }
  return sh;
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function now_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

// Sheets turns date-looking strings into Date cells; read both back as 'yyyy-MM-dd HH:mm' / 'yyyy-MM-dd' text.
function text_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  return v === null || v === undefined ? '' : String(v);
}

function isVerified_(status) { return status === 'Verified' || status === 'Done'; }

// Saves a base64 image to the Drive folder and returns its public view link ('' when there is no image or no folder).
function store_(b64, name, props) {
  if (!b64 || !props.getProperty('FOLDER_ID')) return '';
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name);
  var f = DriveApp.getFolderById(props.getProperty('FOLDER_ID')).createFile(blob);
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (err) { f.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); }
  return 'https://drive.google.com/uc?export=view&id=' + f.getId();
}

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'bad json' }); }
  if (!req.token || req.token !== props.getProperty('TOKEN')) return out_({ error: 'unauthorized' });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // several teammates may run at once
  try {
    var sh = sheet_();
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues() : [];
    var rowOf = function (id) {
      for (var i = 0; i < rows.length; i++) if (rows[i][COL.ID] === id) return i + 2;
      return 0;
    };
    var set = function (row, col, v) { sh.getRange(row, COL[col] + 1).setValue(v); };
    var toObj = function (r) {
      var o = {}; HEADERS.forEach(function (h, i) { o[h] = r[i]; }); return o;
    };

    if (req.action === 'add') {
      var added = 0, reopened = 0, skipped = 0;
      (req.bugs || []).forEach(function (b) {
        var r = rowOf(b.id);
        if (r) {
          // same bug seen again: reopen it if it had been verified fixed, otherwise leave the row alone
          if (isVerified_(rows[r - 2][COL.Status])) {
            var attempts = (Number(rows[r - 2][COL.Attempts]) || 1) + 1;
            set(r, 'Status', 'Open'); set(r, 'Attempts', attempts);
            set(r, 'Note', 'Reopened ' + now_() + ': seen again (attempt ' + attempts + ')'); set(r, 'Updated', now_());
            reopened++;
          } else skipped++;
          return;
        }
        var link = store_(b.imageB64, b.id + '.jpg', props);
        sh.appendRow([b.id, b.date, b.route, b.severity, b.kind, b.title, b.description, b.suggestedFix,
          link ? '=IMAGE("' + link + '")' : '', link, 'Open', '', '', now_(),
          b.env || '', b.area || '', b.test || '', '', '', '', '', 1]);
        sh.setRowHeight(sh.getLastRow(), 120);
        added++;
      });
      return out_({ added: added, reopened: reopened, skipped: skipped });
    }

    if (req.action === 'open') { // only Open: Needs human rows are never handed to an auto-fixer
      var open = rows.filter(function (r) {
        return r[COL.Status] === 'Open' && (!req.env || r[COL.Env] === req.env);
      }).map(toObj).sort(function (a, b) {
        var d = RANK[a.Severity] - RANK[b.Severity];
        if (d) return d;
        var da = text_(a.Date), db = text_(b.Date);
        return da < db ? -1 : da > db ? 1 : 0;
      });
      return out_({ bugs: open.slice(0, req.limit || 5) });
    }

    if (req.action === 'claim') { // Open -> In progress, so two machines never fix the same bug
      var rc = rowOf(req.id);
      if (!rc || rows[rc - 2][COL.Status] !== 'Open') return out_({ ok: false });
      set(rc, 'Status', 'In progress'); set(rc, 'Owner', req.owner || ''); set(rc, 'Updated', now_());
      return out_({ ok: true });
    }

    if (req.action === 'mark') {
      var rm = rowOf(req.id);
      if (!rm) return out_({ ok: false, error: 'unknown id' });
      set(rm, 'Status', req.status); set(rm, 'Note', req.note || ''); set(rm, 'Updated', now_());
      return out_({ ok: true });
    }

    if (req.action === 'resolve') {
      var rr = rowOf(req.id);
      if (!rr) return out_({ ok: false, error: 'unknown id' });
      set(rr, 'Status', req.status);
      if (req.note) set(rr, 'Note', req.note);
      if (req.prUrl) set(rr, 'Fix PR', req.prUrl);
      var after = store_(req.afterImageB64, req.id + '-after.jpg', props);
      if (after) { set(rr, 'After screenshot', '=IMAGE("' + after + '")'); set(rr, 'After link', after); }
      if (req.status === 'Verified') set(rr, 'Verified on', now_());
      set(rr, 'Updated', now_());
      return out_({ ok: true });
    }

    if (req.action === 'summary') {
      var today = now_().slice(0, 10);
      var byStatus = {}, byEnv = {}, newToday = 0, verifiedList = [];
      rows.forEach(function (r) {
        if (!r[COL.ID]) return;
        var st = r[COL.Status] || 'Open', ev = r[COL.Env] || 'unknown';
        byStatus[st] = (byStatus[st] || 0) + 1;
        byEnv[ev] = (byEnv[ev] || 0) + 1;
        if (text_(r[COL.Date]).slice(0, 10) === today) newToday++;
        if (isVerified_(st) && text_(r[COL['Verified on']]).slice(0, 10) === today)
          verifiedList.push({ id: r[COL.ID], page: r[COL.Test] || r[COL.Page], pr: r[COL['Fix PR']], after: r[COL['After link']] });
      });
      return out_({ byStatus: byStatus, byEnv: byEnv, newToday: newToday, verifiedToday: verifiedList.length, verified: verifiedList });
    }
    if (req.action === 'fixed') { // merged fixes waiting for the next run to re-check them on their environment
      var waiting = rows.filter(function (r) {
        return String(r[COL.Status]).indexOf('Fixed') === 0 && (!req.env || r[COL.Env] === req.env);
      }).map(toObj);
      return out_({ rows: waiting });
    }

    if (req.action === 'log') { // one line per daily run, in its own tab
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var rs = ss.getSheetByName('Runs') || ss.insertSheet('Runs');
      if (rs.getLastRow() === 0) { rs.appendRow(['Date', 'Env', 'Status', 'Detail', 'Logged at']); rs.setFrozenRows(1); }
      rs.appendRow([req.date || '', req.env || '', req.status || '', String(req.detail || '').slice(0, 2000), now_()]);
      return out_({ ok: true });
    }

    return out_({ error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}
