import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { companyA } from '@/test/contact-notes-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { getCompany } from './company-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('company api', () => {
  it('reads one company by id', async () => {
    const http = mockFetch(jsonResponse(200, companyA));
    await expect(getCompany(companyA.id)).resolves.toMatchObject({ name: 'Apex IQ' });
    expect(new URL(http.calls[0]!.url).pathname).toBe(`/v2/companies/${companyA.id}`);
  });

  it('fails with the not-found code for a company that is gone', async () => {
    mockFetch(
      jsonResponse(404, {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        code: 'NOT_FOUND',
      }),
    );
    await expect(getCompany(companyA.id)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
