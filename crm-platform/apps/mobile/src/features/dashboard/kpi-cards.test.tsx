import { screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { summary, wallet, widgets } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { AutopilotCard, ContactsCard, ReadRateCard, SentCard, WalletCard } from './kpi-cards';
import { Trend } from './trend';

beforeAll(async () => {
  await initI18n('en');
});

describe('Trend', () => {
  it('says in words how much and which way, for screen readers', async () => {
    const { rerender } = await renderApp(<Trend delta={25} />);
    expect(screen.getByLabelText('Up 25% against the previous period')).toBeTruthy();
    await rerender(<Trend delta={-2.5} unit="pp" />);
    expect(screen.getByLabelText('Down 2.5 pp against the previous period')).toBeTruthy();
    await rerender(<Trend delta={0} />);
    expect(screen.getByLabelText('No change against the previous period')).toBeTruthy();
  });

  it('shows the signed size and an arrow', async () => {
    await renderApp(<Trend delta={12.5} />);
    expect(screen.getByText(/\+12\.5%/)).toBeTruthy();
  });

  it('can treat a fall as good news (fewer failures) or as a nudge (amber)', async () => {
    const { rerender } = await renderApp(<Trend delta={-4} lowerIsBetter />);
    expect(screen.getByText(/-4%/)).toBeTruthy();
    await rerender(<Trend delta={-4} mildDown />);
    expect(screen.getByText(/-4%/)).toBeTruthy();
  });
});

describe('SentCard', () => {
  it('shows the count, the change, the shape over 20 hours and the delivered and failed split', async () => {
    await renderApp(<SentCard summary={summary} range="7d" />);
    expect(screen.getByText('Messages sent · 7d')).toBeTruthy();
    expect(screen.getByText('1,250')).toBeTruthy();
    expect(screen.getByLabelText('Up 25% against the previous period')).toBeTruthy();
    expect(screen.getByRole('image', { name: /Messages sent per hour/ })).toBeTruthy();
    expect(screen.getByText('1180 delivered · 20 failed')).toBeTruthy();
  });

  it('shows a dash until the numbers arrive', async () => {
    await renderApp(<SentCard summary={undefined} range="7d" />);
    expect(screen.getByText('-')).toBeTruthy();
    expect(screen.queryByRole('image')).toBeNull();
  });
});

describe('ReadRateCard', () => {
  it('shows the read rate, its change in points and sent / delivered / read', async () => {
    await renderApp(<ReadRateCard summary={summary} />);
    expect(screen.getByText('Read rate')).toBeTruthy();
    expect(screen.getAllByText('61.2%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Down 2.5 pp against the previous period')).toBeTruthy();
    expect(screen.getByText('1.3k')).toBeTruthy();
    expect(screen.getByText('94.5%')).toBeTruthy();
  });

  it('shows a dash until the numbers arrive', async () => {
    await renderApp(<ReadRateCard summary={undefined} />);
    expect(screen.getByText('-')).toBeTruthy();
  });
});

describe('ContactsCard', () => {
  it('shows the total, the growth and the subscribed, opted-in and blocked counts', async () => {
    await renderApp(<ContactsCard data={widgets.contacts} />);
    expect(screen.getByText('Active contacts')).toBeTruthy();
    expect(screen.getByText('480')).toBeTruthy();
    expect(screen.getByLabelText('Up 4.5% against the previous period')).toBeTruthy();
    expect(screen.getAllByText('400')).toHaveLength(2); // subscribed and opted-in share one count, as on the web
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('shows a dash before the numbers arrive', async () => {
    await renderApp(<ContactsCard data={undefined} />);
    expect(screen.getByText('-')).toBeTruthy();
  });
});

describe('WalletCard and AutopilotCard', () => {
  it('shows the balance in the workspace currency, with the pay-per-message note', async () => {
    await renderApp(<WalletCard wallet={wallet} />);
    expect(screen.getByText('Wallet balance')).toBeTruthy();
    expect(screen.getByText(/2,500\.00/)).toBeTruthy();
    expect(screen.getByText('pay per message')).toBeTruthy();
  });

  it('leaves out the note for a plan-billed workspace', async () => {
    await renderApp(<WalletCard wallet={{ ...wallet, billingMode: 'plan' }} />);
    expect(screen.queryByText('pay per message')).toBeNull();
  });

  it('prompts to put replies on autopilot when there is no balance to show', async () => {
    await renderApp(<AutopilotCard />);
    expect(screen.getByRole('header', { name: 'Put replies on autopilot' })).toBeTruthy();
    expect(screen.getByText('Get more done')).toBeTruthy();
  });
});
