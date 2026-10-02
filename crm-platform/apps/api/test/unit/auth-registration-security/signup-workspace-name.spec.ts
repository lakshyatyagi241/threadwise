import { describe, expect, it } from 'vitest';
import { suggestWorkspaceName, titleCase } from '../../../src/modules/auth/flows/workspace-name';

/** Expected values are what PHP's mb_convert_case(MB_CASE_TITLE) returns, which is what WaDesk's Str::title does. */
describe('workspace name prefill (WD-AUTH-008)', () => {
  it('title-cases the whole local part by Unicode word rules', () => {
    expect(titleCase('priya.sharma')).toBe('Priya.sharma');
    expect(titleCase('john_doe')).toBe('John_Doe');
    expect(titleCase('mary-jane')).toBe('Mary-Jane');
    expect(titleCase('user1abc')).toBe('User1Abc');
    expect(titleCase("o'neil")).toBe("O'neil");
    expect(titleCase('DAVID')).toBe('David');
    expect(titleCase('ÉMILE.zola')).toBe('Émile.zola');
    expect(titleCase('straße')).toBe('Straße');
    expect(titleCase('1234')).toBe('1234');
  });

  it("is the local part, title-cased, plus 's workspace", () => {
    expect(suggestWorkspaceName('priya.sharma@acme.test')).toBe("Priya.sharma's workspace");
    expect(suggestWorkspaceName('info@acme.test')).toBe("Info's workspace");
    // digits stay: WaDesk does not strip them
    expect(suggestWorkspaceName('1234@acme.test')).toBe("1234's workspace");
    expect(suggestWorkspaceName('sales+eu@acme.test')).toBe("Sales+Eu's workspace");
  });
});
