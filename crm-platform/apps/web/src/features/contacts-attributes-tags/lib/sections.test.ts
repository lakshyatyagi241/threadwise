import { describe, expect, it } from 'vitest';
import {
  CORE_SECTIONS,
  parseSection,
  railSections,
  RAIL_SECTIONS,
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
    expect(none.core).toEqual(['overview', 'activities', 'details', 'stats', 'notes', 'files']);
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

  it('draws the quick view rail with seven sections, fewer without the inbox', () => {
    expect([...RAIL_SECTIONS]).toHaveLength(7);
    expect(railSections(() => true)).toEqual([...RAIL_SECTIONS]);
    expect(railSections(grants())).not.toContain('conversations');
  });

  it('puts the overview on the bare contact URL and every other section after it', () => {
    expect(sectionHref('abc', 'overview')).toBe('/contacts/abc');
    expect(sectionHref('abc', 'notes')).toBe('/contacts/abc/notes');
    expect(sectionHref('abc', 'lead-source')).toBe('/contacts/abc/lead-source');
  });
});
