import { describe, expect, it } from 'vitest';
import {
  ACTION_SECTION,
  ADD_TARGETS,
  CORE_SECTIONS,
  pageTabs,
  SECTION_OF_TARGET,
  TAB_MORE,
  TAB_PRIMARY,
  parseAddTarget,
  parseSection,
  quickTabs,
  RELATED_SECTIONS,
  sectionAllowed,
  sectionHref,
  visibleSections,
} from './sections';

const grants =
  (...keys: string[]) =>
  (p: string) =>
    keys.includes(p);

describe('sections', () => {
  it('parses a section id and refuses anything else', () => {
    expect(parseSection('notes')).toBe('notes');
    expect(parseSection('lead-source')).toBe('lead-source');
    for (const bad of ['', null, undefined, 'Notes', 'notes/1', '../x', 'constructor']) {
      expect(parseSection(bad), String(bad)).toBeNull();
    }
  });

  it('keeps every old section of the page under the new nav', () => {
    // tasks, invoices and documents, appointments, lead attribution, consent, the timeline and the details all had a home before
    for (const s of [
      'tasks',
      'sales',
      'appointments',
      'lead-source',
      'consent',
      'activities',
      'details',
    ]) {
      expect([...CORE_SECTIONS, ...RELATED_SECTIONS]).toContain(s);
    }
  });

  it('shows what only the contact read needs, and the rest by permission', () => {
    const none = visibleSections(grants());
    expect(none.core).toEqual([
      'overview',
      'activities',
      'details',
      'stats',
      'notes',
      'meetings',
      'files',
    ]);
    expect(none.related).toEqual(['lead-source', 'history']);
    const all = visibleSections(() => true);
    expect(all.core).toEqual([...CORE_SECTIONS]);
    expect(all.related).toEqual([...RELATED_SECTIONS]);
  });

  it('opens invoices and documents on either permission', () => {
    expect(sectionAllowed('sales', grants('record.invoices.read'))).toBe(true);
    expect(sectionAllowed('sales', grants('record.sales-docs.read'))).toBe(true);
    expect(sectionAllowed('sales', grants())).toBe(false);
    expect(sectionAllowed('deals', grants('record.deals.read'))).toBe(true);
    expect(sectionAllowed('conversations', grants('inbox.conversation.read'))).toBe(true);
    expect(sectionAllowed('conversations', grants('record.contacts.read'))).toBe(false);
  });

  it('draws the quick view tab strip with six tabs and a menu for the rest', () => {
    expect([...TAB_PRIMARY]).toEqual([
      'overview',
      'activities',
      'notes',
      'tasks',
      'meetings',
      'files',
    ]);
    expect([...TAB_MORE]).toEqual(['conversations', 'stats', 'details']);
    const all = quickTabs(() => true);
    expect(all.primary).toEqual([...TAB_PRIMARY]);
    expect(all.more).toEqual([...TAB_MORE]);
  });

  it('leaves out the tabs whose permission is missing, and keeps every old drawer section reachable', () => {
    const none = quickTabs(grants());
    expect(none.primary).not.toContain('tasks');
    expect(none.more).not.toContain('conversations');
    const some = quickTabs(grants('record.tasks.read', 'inbox.conversation.read'));
    expect(some.primary).toContain('tasks');
    expect(some.more).toContain('conversations');
    // the seven sections the drawer's rail had before are all still tabs or in the menu
    for (const s of [
      'overview',
      'activities',
      'conversations',
      'notes',
      'stats',
      'files',
      'details',
    ]) {
      expect([...quickTabs(() => true).primary, ...quickTabs(() => true).more]).toContain(s);
    }
  });

  it('points each add button at the section of its inline composer', () => {
    expect(SECTION_OF_TARGET).toEqual({
      note: 'notes',
      task: 'tasks',
      meeting: 'meetings',
      company: 'overview',
      call: 'activities',
      score: 'overview',
    });
    for (const t of ADD_TARGETS) expect(parseAddTarget(t)).toBe(t);
    for (const bad of [null, undefined, '', 'Task', 'tasks', 'constructor']) {
      expect(parseAddTarget(bad), String(bad)).toBeNull();
    }
    // every composer lives in a section the drawer draws
    for (const s of Object.values(SECTION_OF_TARGET)) {
      expect([...TAB_PRIMARY, ...TAB_MORE]).toContain(s);
    }
  });

  it('sends the action bar to the compose box of the Activity tab, and the company and the lead score to the overview', () => {
    expect(ACTION_SECTION).toEqual({
      note: 'activities',
      task: 'activities',
      meeting: 'activities',
      call: 'activities',
      company: 'overview',
      score: 'overview',
    });
    for (const s of Object.values(ACTION_SECTION)) {
      expect([...TAB_PRIMARY, ...TAB_MORE]).toContain(s);
    }
  });

  it('puts every section in exactly one place of the tab bar: five tabs, then More', () => {
    const { primary, more } = pageTabs(() => true);
    expect(primary).toEqual(['overview', 'activities', 'conversations', 'deals', 'files']);
    const listed = [...primary, ...more];
    expect([...listed].sort()).toEqual([...CORE_SECTIONS, ...RELATED_SECTIONS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('leaves out what a person may not open', () => {
    const none = pageTabs(() => false);
    expect(none.primary).toEqual(['overview', 'activities', 'files']);
    expect(none.more).toContain('notes');
    expect(none.more).toContain('history');
    for (const gated of ['tasks', 'appointments', 'sales', 'company', 'consent']) {
      expect(none.more).not.toContain(gated);
    }
    const inbox = pageTabs((p) => p === 'inbox.conversation.read' || p === 'record.deals.read');
    expect(inbox.primary).toContain('conversations');
    expect(inbox.primary).toContain('deals');
  });

  it('puts the overview on the bare contact URL and every other section after it', () => {
    expect(sectionHref('abc', 'overview')).toBe('/contacts/abc');
    expect(sectionHref('abc', 'notes')).toBe('/contacts/abc/notes');
    expect(sectionHref('abc', 'lead-source')).toBe('/contacts/abc/lead-source');
  });
});

describe('sections hidden by the workspace persona', () => {
  const hide =
    (...ids: string[]) =>
    (s: string) =>
      ids.includes(s);

  it('without a predicate (or hiding nothing) nothing changes', () => {
    expect(
      pageTabs(
        () => true,
        () => false,
      ),
    ).toEqual(pageTabs(() => true));
    expect(
      quickTabs(
        () => true,
        () => false,
      ),
    ).toEqual(quickTabs(() => true));
    expect(
      visibleSections(
        () => true,
        () => false,
      ),
    ).toEqual(visibleSections(() => true));
  });

  it('drops a hidden section from the page tabs, the quick view and the section list', () => {
    const page = pageTabs(() => true, hide('deals', 'meetings'));
    expect([...page.primary, ...page.more]).not.toContain('deals');
    expect([...page.primary, ...page.more]).not.toContain('meetings');
    expect(page.primary).toEqual(['overview', 'activities', 'conversations', 'files']);

    const quick = quickTabs(() => true, hide('meetings'));
    expect(quick.primary).not.toContain('meetings');
    expect(quick.primary).toContain('notes');

    const all = visibleSections(() => true, hide('meetings', 'appointments'));
    expect(all.core).not.toContain('meetings');
    expect(all.related).not.toContain('appointments');
  });

  it('hiding is not locking: permission still decides, and the section id still parses and is allowed', () => {
    // Hidden from the strip, but a link to it is still understood and the permission check is unchanged.
    expect(parseSection('meetings')).toBe('meetings');
    expect(sectionAllowed('meetings', () => true)).toBe(true);
    expect(sectionAllowed('deals', grants())).toBe(false);
    // A shown section the person has no permission for stays out, whatever the persona says.
    const page = pageTabs(grants(), hide());
    expect([...page.primary, ...page.more]).not.toContain('deals');
  });

  it('every section the strip can hide is a catalog section id', () => {
    for (const s of [...CORE_SECTIONS, ...RELATED_SECTIONS]) {
      expect(pageTabs(() => true, hide(s)).primary).not.toContain(s);
      expect(pageTabs(() => true, hide(s)).more).not.toContain(s);
    }
  });
});
