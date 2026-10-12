import { render, screen } from '@testing-library/react-native';
import { Badge } from './badge';

describe('Badge', () => {
  it.each(['success', 'warning', 'danger', 'info', 'neutral'] as const)(
    'shows its words in the %s tone',
    async (tone) => {
      await render(<Badge tone={tone} label="Sending" />);
      expect(screen.getByText('Sending')).toBeTruthy();
    },
  );

  it('is neutral by default', async () => {
    await render(<Badge label="Draft" />);
    expect(screen.getByText('Draft')).toBeTruthy();
  });
});
