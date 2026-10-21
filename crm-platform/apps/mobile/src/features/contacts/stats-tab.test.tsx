import { fireEvent, screen } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { renderApp } from '@/test/render';
import * as statsApi from './message-stats-api';
import { StatsTab } from './stats-tab';

jest.mock('./message-stats-api');

const statsCall = jest.mocked(statsApi.getContactMessageStats);
const stats = { sent: 12, delivered: 10, seen: 7, received: 5, failed: 1, replied: 4 };

beforeEach(() => statsCall.mockReset());

describe('StatsTab', () => {
  it("shows the WhatsApp summary as the API counted it, in the Geta app's order first", async () => {
    statsCall.mockResolvedValue(stats);
    await renderApp(<StatsTab contactId="c-1" />);
    expect(await screen.findByRole('header', { name: 'WhatsApp summary' })).toBeTruthy();
    for (const [label, value] of [
      ['Sent', '12'],
      ['Delivered', '10'],
      ['Replied', '4'],
      ['Seen', '7'],
      ['Received', '5'],
      ['Failed', '1'],
    ] as const) {
      expect(screen.getByLabelText(`${label}: ${value}`)).toBeTruthy();
    }
    expect(statsCall).toHaveBeenCalledWith('c-1', expect.anything());
  });

  it('shows zeros for a contact with no WhatsApp messages', async () => {
    statsCall.mockResolvedValue({
      sent: 0,
      delivered: 0,
      seen: 0,
      received: 0,
      failed: 0,
      replied: 0,
    });
    await renderApp(<StatsTab contactId="c-1" />);
    expect(await screen.findByLabelText('Sent: 0')).toBeTruthy();
    expect(screen.getByLabelText('Seen: 0')).toBeTruthy();
  });

  it('says so and offers a retry when the summary cannot be read', async () => {
    statsCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    statsCall.mockResolvedValue(stats);
    await renderApp(<StatsTab contactId="c-1" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Sent: 12')).toBeTruthy();
  });
});
