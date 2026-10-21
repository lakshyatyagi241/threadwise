import { screen } from '@testing-library/react-native';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { Text } from '@/components/ui/text';
import { fetchSession } from '@/lib/session/api';
import { sessionProps, statusOptions } from '@/test/contact-properties-fixtures';
import { sessionFull } from '@/test/contacts-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { renderApp } from '@/test/render';
import { useLifecycleNames } from './use-lifecycle-names';

jest.mock('@/lib/session/api');

const sessionCall = jest.mocked(fetchSession);
const page = { data: statusOptions, page: { nextCursor: null, hasMore: false, limit: 200 } };

/** A line of text with the names of a few values, so a test reads what the panel would show. */
function Probe() {
  const { stageName, statusName } = useLifecycleNames();
  return (
    <Text testID="names">
      {[
        stageName('qualified'),
        stageName('new'),
        stageName('zzz'),
        statusName('Hot'),
        statusName('vip'),
      ].join(' | ')}
    </Text>
  );
}

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('useLifecycleNames', () => {
  it("names a stage and a status by the workspace's words, and the rest by the built-in names or as stored", async () => {
    sessionCall.mockResolvedValue(sessionProps);
    const http = mockFetch(jsonResponse(200, page));
    await renderApp(<Probe />);
    expect(await screen.findByText('Qualified | New lead | zzz | Hot lead | VIP')).toBeTruthy();
    expect(new URL(http.calls[0]!.url).pathname).toBe('/v2/status-options');
  });

  it('uses the built-in names, and asks for nothing, when the person may not read the options', async () => {
    sessionCall.mockResolvedValue(sessionFull);
    const http = mockFetch(jsonResponse(200, page));
    await renderApp(<Probe />);
    expect(await screen.findByText('Qualified | New | zzz | Hot | VIP')).toBeTruthy();
    expect(http.calls).toHaveLength(0);
  });
});
