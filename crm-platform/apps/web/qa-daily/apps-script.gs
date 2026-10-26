/**
 * Paste into the Google Sheet: Extensions > Apps Script. Then Project Settings > Script properties, add:
 *   TOKEN      a long random string (the same value goes in QA_SHEET_TOKEN on every machine)
 *   FOLDER_ID  id of a Drive folder that will hold the screenshots (the part after /folders/ in its URL)
 * Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone. Copy the /exec URL into QA_SHEET_URL.
 * Anyone with the URL still needs TOKEN; every call is rejected without it.
 */
var HEADERS = ['ID', 'Date', 'Page', 'Severity', 'Type', 'Bug', 'Description', 'Suggested fix',
  'Screenshot', 'Screenshot link', 'Status', 'Owner', 'Note', 'Updated'];
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
  }
  return sh;
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function now_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

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

    if (req.action === 'add') {
      var added = 0, reopened = 0, skipped = 0;
      (req.bugs || []).forEach(function (b) {
        var r = rowOf(b.id);
        if (r) {
          // same bug seen again: reopen it if it had been marked Done, otherwise leave the row alone
          if (rows[r - 2][COL.Status] === 'Done') {
            set(r, 'Status', 'Open'); set(r, 'Note', 'Reopened ' + now_() + ': seen again'); set(r, 'Updated', now_());
            reopened++;
          } else skipped++;
          return;
        }
        var link = '';
        if (b.imageB64 && props.getProperty('FOLDER_ID')) {
          var blob = Utilities.newBlob(Utilities.base64Decode(b.imageB64), 'image/jpeg', b.id + '.jpg');
          var f = DriveApp.getFolderById(props.getProperty('FOLDER_ID')).createFile(blob);
          try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
          catch (err) { f.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); }
          link = 'https://drive.google.com/uc?export=view&id=' + f.getId();
        }
        sh.appendRow([b.id, b.date, b.route, b.severity, b.kind, b.title, b.description, b.suggestedFix,
          link ? '=IMAGE("' + link + '")' : '', link, 'Open', '', '', now_()]);
        sh.setRowHeight(sh.getLastRow(), 120);
        added++;
      });
      return out_({ added: added, reopened: reopened, skipped: skipped });
    }

    if (req.action === 'open') {
      var open = rows.filter(function (r) { return r[COL.Status] === 'Open'; }).map(function (r) {
        var o = {}; HEADERS.forEach(function (h, i) { o[h] = r[i]; }); return o;
      }).sort(function (a, b) { return RANK[a.Severity] - RANK[b.Severity]; });
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
    return out_({ error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}
