import { describe, expect, it } from 'vitest';
import { FB_PAGE_STATUSES, META_LEAD_ACCESS, META_LEAD_SYNC_STATES } from '@crm/contracts';
import { metaForm, metaOverview, metaPage } from '../test-fixtures';
import {
  ACCESS_TONE,
  PAGE_STATUS_TONE,
  SYNC_TONE,
  blockHintKey,
  formStatusKey,
  metaSummary,
  needsLeadAccess,
  needsReconnect,
  pageActions,
  parseConnectNotice,
  safeLoginUrl,
  sortForms,
  withPage,
} from './meta-view';

const params = (query: string) => new URLSearchParams(query);

describe('tones', () => {
  it('give every sync state, Page status and lead access a tone', () => {
    for (const s of META_LEAD_SYNC_STATES) expect(SYNC_TONE[s], s).toBeTypeOf('string');
    for (const s of FB_PAGE_STATUSES) expect(PAGE_STATUS_TONE[s], s).toBeTypeOf('string');
    for (const a of META_LEAD_ACCESS) expect(ACCESS_TONE[a], a).toBeTypeOf('string');
    expect(SYNC_TONE.subscribed).toBe('success');
    expect(SYNC_TONE.error).toBe('danger');
    expect(SYNC_TONE.needs_lead_access).toBe('warning');
  });
});

describe('what a Page offers', () => {
  it('a healthy Page can be turned off and its forms chosen, with no login', () => {
    expect(pageActions(metaPage())).toEqual({
      login: null,
      toggle: 'disable',
      toggleBlock: null,
      pickBlock: null,
    });
  });

  it('a Page with lead sync off can be turned on, but its forms wait for that', () => {
    const p = metaPage({ sync: { enabled: false, state: 'off', formsConnected: 0 } });
    expect(pageActions(p)).toEqual({
      login: null,
      toggle: 'enable',
      toggleBlock: null,
      pickBlock: 'syncOff',
    });
  });

  it('a Page without lead access offers "grant" and holds back turning on and picking', () => {
    const p = metaPage({
      leadAccess: 'missing',
      missingScopes: ['leads_retrieval'],
      sync: { enabled: false, state: 'off' },
    });
    expect(needsLeadAccess(p)).toBe(true);
    expect(pageActions(p)).toEqual({
      login: 'grant',
      toggle: 'enable',
      toggleBlock: 'leadAccess',
      pickBlock: 'leadAccess',
    });
  });

  it('a Page whose sync says needs_lead_access offers "grant" even when the access reads granted', () => {
    const p = metaPage({ sync: { state: 'needs_lead_access' } });
    expect(pageActions(p).login).toBe('grant');
    expect(pageActions(p).pickBlock).toBe('leadAccess');
    // lead sync stays on, so it can still be turned off
    expect(pageActions(p).toggle).toBe('disable');
    expect(pageActions(p).toggleBlock).toBeNull();
  });

  it('needs_reconnect, an expired and a disconnected Page offer "reconnect", which wins over "grant"', () => {
    const states = [
      metaPage({ sync: { state: 'needs_reconnect' } }),
      metaPage({ pageStatus: 'expired' }),
      metaPage({ pageStatus: 'disconnected' }),
      metaPage({ leadAccess: 'missing', sync: { state: 'needs_reconnect' } }),
    ];
    for (const p of states) {
      expect(needsReconnect(p)).toBe(true);
      expect(pageActions(p).login).toBe('reconnect');
      expect(pageActions(p).pickBlock).toBe('reconnect');
    }
  });

  it('a Page in error keeps its forms open (Meta decides) and offers no login', () => {
    const p = metaPage({ sync: { state: 'error', lastError: 'Meta said no' } });
    expect(pageActions(p)).toEqual({
      login: null,
      toggle: 'disable',
      toggleBlock: null,
      pickBlock: null,
    });
  });

  it('names the hint for each held-back action', () => {
    expect(blockHintKey('enable', 'leadAccess')).toBe('enableNeedsAccess');
    expect(blockHintKey('enable', 'reconnect')).toBe('enableNeedsReconnect');
    expect(blockHintKey('pick', 'syncOff')).toBe('pickNeedsSync');
    expect(blockHintKey('pick', 'leadAccess')).toBe('pickNeedsAccess');
    expect(blockHintKey('pick', 'reconnect')).toBe('pickNeedsReconnect');
  });
});

describe('the provider card', () => {
  it('counts Pages, live Pages, picked forms and Pages that need a person', () => {
    const o = metaOverview({
      pages: [
        metaPage({ id: 'a', sync: { formsConnected: 2 } }),
        metaPage({ id: 'b', sync: { state: 'needs_lead_access', formsConnected: 1 } }),
        metaPage({ id: 'c', sync: { state: 'needs_reconnect', formsConnected: 0 } }),
        metaPage({ id: 'd', sync: { state: 'error', formsConnected: 0 } }),
        metaPage({ id: 'e', sync: { enabled: false, state: 'off', formsConnected: 0 } }),
      ],
    });
    expect(metaSummary(o)).toEqual({ configured: true, pages: 5, live: 1, forms: 3, attention: 3 });
    expect(metaSummary(metaOverview({ configured: false, pages: [] }))).toMatchObject({
      configured: false,
      pages: 0,
      forms: 0,
    });
  });

  it('replaces one Page by its fresh copy and leaves the rest alone', () => {
    const a = metaPage({ id: 'a' });
    const b = metaPage({ id: 'b' });
    const fresh = metaPage({ id: 'b', sync: { enabled: false, state: 'off' } });
    const next = withPage(metaOverview({ pages: [a, b] }), fresh);
    expect(next.pages[0]).toBe(a);
    expect(next.pages[1]).toBe(fresh);
  });
});

describe('the forms', () => {
  it('shows picked forms first and keeps Meta order otherwise', () => {
    const forms = [
      metaForm({ formId: '10001' }),
      metaForm({ formId: '10002', connected: true }),
      metaForm({ formId: '10003' }),
      metaForm({ formId: '10004', connected: true }),
    ];
    expect(sortForms(forms).map((f) => f.formId)).toEqual(['10002', '10004', '10001', '10003']);
  });

  it('turns Meta status words into message keys, and anything else into unknown', () => {
    for (const s of ['ACTIVE', 'ARCHIVED', 'DELETED', 'DRAFT']) expect(formStatusKey(s)).toBe(s);
    expect(formStatusKey('PAUSED')).toBe('unknown');
    expect(formStatusKey(null)).toBe('unknown');
  });
});

describe('the login round trip', () => {
  it('reads a connected or failed notice once from the address', () => {
    expect(parseConnectNotice(params('tab=ads&fb=connected&message=Page%20connected'))).toEqual({
      ok: true,
      text: 'Page connected',
    });
    expect(parseConnectNotice(params('fb=error&message=Denied'))).toEqual({
      ok: false,
      text: 'Denied',
    });
  });

  it('shows nothing for an unknown value, a missing or blank message, or no parameters', () => {
    expect(parseConnectNotice(params('fb=maybe&message=x'))).toBeNull();
    expect(parseConnectNotice(params('fb=connected'))).toBeNull();
    expect(parseConnectNotice(params('fb=connected&message=%20%20'))).toBeNull();
    expect(parseConnectNotice(params('tab=ads'))).toBeNull();
  });

  it('cuts a very long message', () => {
    const long = 'x'.repeat(900);
    expect(parseConnectNotice(params(`fb=error&message=${long}`))?.text).toHaveLength(300);
  });

  it('follows a web address only', () => {
    expect(safeLoginUrl('https://www.facebook.com/dialog/oauth?x=1')).toBe(
      'https://www.facebook.com/dialog/oauth?x=1',
    );
    expect(safeLoginUrl('javascript:alert(1)')).toBeNull();
    expect(safeLoginUrl('data:text/html,hi')).toBeNull();
    expect(safeLoginUrl('not a url')).toBeNull();
  });
});
