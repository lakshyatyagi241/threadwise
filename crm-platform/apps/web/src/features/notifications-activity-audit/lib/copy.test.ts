import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { badgeText, notificationText, safeLink, type Translator } from './copy';

const load = (locale: string) =>
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'messages', locale, 'notifications-activity-audit.json'),
      'utf8',
    ),
  ) as { notifications: Record<string, unknown> };

const translator = (locale: 'en' | 'ar'): Translator =>
  createTranslator({
    locale,
    messages: load(locale).notifications as never,
  }) as unknown as Translator;

const n = (type: string, data: Record<string, unknown> | null) => ({
  type,
  title: 'Server title',
  body: 'Server body',
  data,
});

describe('notificationText', () => {
  it('words a known type from its data, in the viewer language', () => {
    const data = { taskTitle: 'Call the supplier', actorName: 'Asha' };
    expect(notificationText(translator('en'), n('task_assigned', data))).toEqual({
      title: 'Task assigned to you',
      body: 'Asha assigned you: Call the supplier',
    });
    const ar = notificationText(translator('ar'), n('task_assigned', data));
    expect(ar.title).toBe('تم إسناد مهمة إليك');
    expect(ar.body).toContain('Asha');
    expect(ar.body).toContain('Call the supplier');
  });

  it('drops the actor when there is none (the due reminder)', () => {
    expect(
      notificationText(
        translator('en'),
        n('task_due', { taskTitle: 'Send quote', actorName: null }),
      ),
    ).toEqual({ title: 'Task due', body: 'Send quote' });
    expect(
      notificationText(translator('en'), n('task_assigned', { taskTitle: 'X', actorName: null }))
        .body,
    ).toBe('X');
  });

  it('words a lead from its contact and platform, and a returning lead apart (new_lead)', () => {
    const data = { contactName: 'Ada', platform: 'Facebook', returning: false };
    expect(notificationText(translator('en'), n('new_lead', data))).toEqual({
      title: 'New lead',
      body: 'Ada came in from Facebook',
    });
    expect(notificationText(translator('en'), n('new_lead', { ...data, returning: true }))).toEqual(
      { title: 'Lead came in again', body: 'Ada sent another lead from Facebook' },
    );
    expect(
      notificationText(translator('en'), n('new_lead', { contactName: 'Ada', platform: '' })).body,
    ).toBe('Ada came in');
    const ar = notificationText(translator('ar'), n('new_lead', data));
    expect(ar.title).toBe('عميل محتمل جديد');
    expect(ar.body).toContain('Ada');
    expect(notificationText(translator('en'), n('new_lead', null)).body).toBeNull();
  });

  it('shows the server wording for a type it has no message for', () => {
    expect(notificationText(translator('en'), n('deal_won', { dealTitle: 'Big' }))).toEqual({
      title: 'Server title',
      body: 'Server body',
    });
  });

  it('survives missing data', () => {
    expect(notificationText(translator('en'), n('task_completed', null))).toEqual({
      title: 'Task completed',
      body: null,
    });
  });
});

describe('safeLink', () => {
  it('keeps app paths and refuses anything that could leave the app', () => {
    expect(safeLink('/tasks?task=1')).toBe('/tasks?task=1');
    for (const bad of ['https://evil.test', '//evil.test', 'javascript:alert(1)', 'tasks', '']) {
      expect(safeLink(bad), bad).toBeNull();
    }
    expect(safeLink(null)).toBeNull();
  });
});

describe('badgeText', () => {
  it('is empty at zero and caps at 99+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});
