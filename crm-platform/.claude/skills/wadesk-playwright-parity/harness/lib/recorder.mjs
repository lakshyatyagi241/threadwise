// Passive capture on every page of a side: console, uncaught errors, HTTP traffic, dialogs, downloads, popups,
// websockets and navigations. Scenarios read it through c.rec; the runner stores the totals with the observation.
import { pathTemplate, oneLine } from './util.mjs';

export class Recorder {
  constructor({ side, origin, ignore, dialogPolicy = 'accept' }) {
    this.side = side;
    this.origin = origin;
    this.ignore = ignore || { console: [], requests: [] };
    this.dialogPolicy = dialogPolicy; // accept | dismiss | record (record = leave it to the scenario)
    this.events = {
      console: [],
      pageErrors: [],
      failed: [],
      http: [],
      dialogs: [],
      downloads: [],
      popups: [],
      websockets: [],
      navigations: [],
    };
    this.t0 = Date.now();
    this.pages = new Set();
  }

  attach(page) {
    if (this.pages.has(page)) return page;
    this.pages.add(page);
    const ev = this.events;
    const now = () => Date.now() - this.t0;

    page.on('console', (m) => {
      const type = m.type();
      if (type !== 'error' && type !== 'warning') return;
      const text = oneLine(m.text(), 300);
      if (this.ignore.console.some((rx) => rx.test(text) || rx.test(m.location()?.url || '')))
        return;
      ev.console.push({ at: now(), type, text });
    });
    page.on('pageerror', (e) =>
      ev.pageErrors.push({ at: now(), message: oneLine(e?.message || e, 300) }),
    );
    page.on('requestfailed', (r) => {
      const url = r.url();
      if (this.ignore.requests.some((rx) => rx.test(url))) return;
      const err = r.failure()?.errorText || '';
      if (/ERR_ABORTED|aborted/i.test(err)) return; // navigation cancelled by the next click, not a failure
      ev.failed.push({
        at: now(),
        method: r.method(),
        path: pathTemplate(url, this.origin),
        error: err,
      });
    });
    page.on('response', (r) => {
      const q = r.request();
      const type = q.resourceType();
      if (!['document', 'xhr', 'fetch'].includes(type)) return;
      const url = r.url();
      if (this.ignore.requests.some((rx) => rx.test(url))) return;
      ev.http.push({
        at: now(),
        method: q.method(),
        path: pathTemplate(url, this.origin),
        status: r.status(),
        type,
        redirected: q.redirectedFrom() ? true : false,
      });
    });
    page.on('dialog', async (d) => {
      ev.dialogs.push({ at: now(), type: d.type(), message: oneLine(d.message(), 200) });
      if (this.dialogPolicy === 'record') return;
      try {
        if (this.dialogPolicy === 'dismiss') await d.dismiss();
        else await d.accept();
      } catch {
        /* dialog already handled */
      }
    });
    page.on('download', (d) => ev.downloads.push({ at: now(), name: d.suggestedFilename() }));
    page.on('popup', (p) => {
      ev.popups.push({ at: now(), url: pathTemplate(p.url(), this.origin) });
      this.attach(p);
    });
    page.on('websocket', (w) =>
      ev.websockets.push({ at: now(), url: pathTemplate(w.url(), this.origin) }),
    );
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame())
        ev.navigations.push({ at: now(), path: pathTemplate(f.url(), this.origin) });
    });
    return page;
  }

  mark() {
    return Object.fromEntries(Object.entries(this.events).map(([k, v]) => [k, v.length]));
  }

  since(mark = {}) {
    return Object.fromEntries(
      Object.entries(this.events).map(([k, v]) => [k, v.slice(mark[k] || 0)]),
    );
  }

  /** Summary used by the comparator: counts, not texts (texts are copy). */
  summary(since = {}) {
    const e = this.since(since);
    const data = e.http.filter((h) => h.type !== 'document');
    return {
      consoleErrors: e.console.filter((c) => c.type === 'error').length,
      consoleWarnings: e.console.filter((c) => c.type === 'warning').length,
      pageErrors: e.pageErrors.length,
      failedRequests: e.failed.length,
      http4xx: e.http.filter((h) => h.status >= 400 && h.status < 500).length,
      http5xx: e.http.filter((h) => h.status >= 500).length,
      dataRequests: data.length,
      navigations: e.navigations.length,
      dialogs: e.dialogs.length,
      downloads: e.downloads.length,
      popups: e.popups.length,
      websockets: e.websockets.length,
    };
  }
}
