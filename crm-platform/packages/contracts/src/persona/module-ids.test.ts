import { describe, expect, it } from 'vitest';
import { moduleId, moduleIdSchema, moduleKindOf } from './module-ids';

describe('module ids', () => {
  it('builds the five kinds of id', () => {
    expect(moduleId('nav', 'inbox')).toBe('nav:inbox');
    expect(moduleId('tile', 'booking-types')).toBe('tile:booking-types');
    expect(moduleId('section', 'meetings')).toBe('section:contact.meetings');
    expect(moduleId('card', 'inbox')).toBe('card:dashboard.inbox');
    expect(moduleId('action', 'meeting')).toBe('action:contact.meeting');
  });

  it('accepts every built id and reads its kind back', () => {
    for (const id of [
      'nav:inbox',
      'tile:appointment-settings',
      'section:contact.lead-source',
      'card:dashboard.checklist',
      'action:contact.meeting',
    ]) {
      expect(moduleIdSchema.safeParse(id).success, id).toBe(true);
      expect(moduleKindOf(id)).toBe(id.split(':')[0]);
    }
  });

  it.each([
    '',
    'inbox',
    'nav:',
    'nav:Inbox',
    'nav:in box',
    'nav:contact.meetings',
    'section:meetings',
    'section:deal.notes',
    'card:inbox',
    'widget:inbox',
    'nav:inbox\n',
  ])('rejects %j', (id) => {
    expect(moduleIdSchema.safeParse(id).success).toBe(false);
  });

  it('knows no kind for something that is not an id', () => {
    expect(moduleKindOf('inbox')).toBeNull();
    expect(moduleKindOf('widget:x')).toBeNull();
  });
});
