import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { classifyLaunchError } from './launch-errors';

const err = (
  status: number,
  code: string,
  fieldErrors: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, 'text that may change', 'req-1', fieldErrors);

describe('classifyLaunchError', () => {
  it('422 WALLET_EMPTY goes to the credit check', () => {
    expect(classifyLaunchError(err(422, 'WALLET_EMPTY'))).toEqual({ kind: 'wallet', step: 3 });
  });

  it('422 CAMP_WIZARD_INCOMPLETE opens the step that owns the first problem', () => {
    const f = classifyLaunchError(
      err(422, 'CAMP_WIZARD_INCOMPLETE', [
        { path: 'schedule.date', message: 'schedule_in_past' },
        { path: 'variables.body.1', message: 'variable_unmapped' },
        { path: 'name', message: 'name_required' },
      ]),
    );
    expect(f).toMatchObject({ kind: 'incomplete', step: 1, steps: [1, 3, 4] });
    expect(f.kind === 'incomplete' && f.issues[1]).toEqual({
      path: 'variables.body.1',
      code: 'variable_unmapped',
    });
  });

  it('a launch refused by the eligibility check goes back to step 3 and names the groups', () => {
    expect(
      classifyLaunchError(
        err(422, 'CAMP_TEMPLATE_NOT_ALLOWED', [
          { path: 'eligibility.template', message: 'template_paused' },
        ]),
      ),
    ).toEqual({ kind: 'eligibility', step: 3, groups: ['template'] });
    expect(
      classifyLaunchError(
        err(422, 'CAMP_NO_RECIPIENTS', [
          { path: 'eligibility.contacts', message: 'contacts_none_eligible' },
        ]),
      ),
    ).toEqual({ kind: 'eligibility', step: 3, groups: ['contacts'] });
    // The same codes without the group are an ordinary failure.
    expect(classifyLaunchError(err(422, 'CAMP_NO_RECIPIENTS'))).toMatchObject({ kind: 'other' });
  });

  it('an incomplete error with no details still opens a step', () => {
    expect(classifyLaunchError(err(422, 'CAMP_WIZARD_INCOMPLETE'))).toMatchObject({
      kind: 'incomplete',
      step: 1,
    });
  });

  it('409 is a conflict, and an already launched draft is said so', () => {
    expect(classifyLaunchError(err(409, 'ROW_VERSION_CONFLICT'))).toEqual({ kind: 'conflict' });
    expect(classifyLaunchError(err(409, 'CAMP_WIZARD_LAUNCHED'))).toEqual({ kind: 'launched' });
  });

  it('anything else keeps the request id', () => {
    expect(classifyLaunchError(err(500, 'INTERNAL'))).toMatchObject({
      kind: 'other',
      requestId: 'req-1',
    });
    expect(classifyLaunchError(new Error('offline'))).toEqual({
      kind: 'other',
      message: 'offline',
    });
    expect(classifyLaunchError('x')).toEqual({ kind: 'other', message: '' });
  });
});
