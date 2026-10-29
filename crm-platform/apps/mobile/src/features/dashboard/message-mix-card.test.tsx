import { screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { messageInsights } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { MessageMixCard } from './message-mix-card';

beforeAll(async () => {
  await initI18n('en');
});

describe('MessageMixCard', () => {
  it('shows the total and one row per kind of message', async () => {
    await renderApp(
      <MessageMixCard mix={messageInsights.typeMix} rangeName="13 Sep – 12 Oct 2026" />,
    );
    expect(screen.getByRole('header', { name: 'Message by categories' })).toBeTruthy();
    expect(screen.getByText('13 Sep – 12 Oct 2026')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByLabelText('Plain text: 4')).toBeTruthy();
    expect(screen.getByLabelText('Auto-reply: 3')).toBeTruthy();
    expect(screen.getByLabelText('Campaign: 2')).toBeTruthy();
    expect(screen.getByLabelText('Broadcast: 1')).toBeTruthy();
    expect(screen.getByLabelText('Scheduled: 0')).toBeTruthy();
    expect(screen.getByLabelText('Media: 10')).toBeTruthy();
  });

  it('shows zeros, not dashes, when the window had no messages', async () => {
    await renderApp(
      <MessageMixCard
        mix={{ text: 0, autoReply: 0, campaign: 0, broadcast: 0, scheduled: 0, media: 0 }}
        rangeName="today"
      />,
    );
    expect(screen.getByLabelText('Plain text: 0')).toBeTruthy();
    // The total on the title line and the six rows all read 0.
    expect(screen.getAllByText('0')).toHaveLength(7);
  });

  it('shows a dash for every figure until the numbers arrive or when they cannot be read', async () => {
    await renderApp(<MessageMixCard mix={undefined} rangeName="today" />);
    expect(screen.getByLabelText('Plain text: —')).toBeTruthy();
    expect(screen.getByLabelText('Media: —')).toBeTruthy();
    expect(screen.queryByLabelText('Plain text: 0')).toBeNull();
  });
});
