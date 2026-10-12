import i18next from 'i18next';
import { ApiError } from '@/lib/api';
import { describeTaskFailure, isNotFound, isPlanLocked } from './task-errors';

const t = i18next.t.bind(i18next);

describe('describeTaskFailure', () => {
  it('flags a stale version as a conflict, without a message', () => {
    const failure = describeTaskFailure(new ApiError(409, 'ROW_VERSION_CONFLICT', 'Conflict'), t);
    expect(failure).toEqual({ banner: null, fields: {}, conflict: true });
  });

  it('says when the plan has no tasks', () => {
    const failure = describeTaskFailure(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'Locked'), t);
    expect(failure.banner).toBe('Tasks are not included in this plan.');
  });

  it('says when the task is gone', () => {
    const failure = describeTaskFailure(new ApiError(404, 'NOT_FOUND', 'Gone'), t);
    expect(failure.banner).toBe('This task no longer exists.');
  });

  it('puts a refused assignee in the banner', () => {
    const failure = describeTaskFailure(new ApiError(422, 'TASK_ASSIGNEE_INVALID', 'Bad'), t);
    expect(failure.banner).toBe("That person can't be given tasks. Choose another owner.");
  });

  it('puts the fields the server names under their fields, in the app’s own words', () => {
    const failure = describeTaskFailure(
      new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
        { path: 'title', message: 'Too small' },
        { path: 'dueAt', message: 'Invalid datetime' },
        { path: 'contactId', message: 'Invalid uuid' },
      ]),
      t,
    );
    expect(failure.banner).toBeNull();
    expect(failure.fields).toEqual({
      title: 'Enter a task title.',
      date: "This due date and time can't be used.",
      contact: "This contact can't be linked.",
    });
  });

  it('falls back to the generic message for anything else', () => {
    expect(describeTaskFailure(new ApiError(0, 'CLIENT_NETWORK', 'offline'), t).banner).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(describeTaskFailure(new Error('boom'), t).banner).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('code checks', () => {
  it('tell a locked plan and a missing task apart by their code', () => {
    expect(isPlanLocked(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'x'))).toBe(true);
    expect(isPlanLocked(new ApiError(422, 'VALIDATION_FAILED', 'x'))).toBe(false);
    expect(isPlanLocked(new Error('PLAN_FEATURE_LOCKED'))).toBe(false);
    expect(isNotFound(new ApiError(404, 'NOT_FOUND', 'x'))).toBe(true);
    expect(isNotFound(new ApiError(404, 'SOMETHING_ELSE', 'x'))).toBe(false);
  });
});
