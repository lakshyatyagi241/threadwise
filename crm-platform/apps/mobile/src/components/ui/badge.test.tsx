import { render, screen } from '@testing-library/react-native';
import { Badge } from './badge';

describe('Badge', () => {
  it.each(['success', 'warning', 'danger', 'info', 'neutral'] as const)(
    'shows its words in the %s tone',
    (tone) => {
      render(<Badge tone={tone} label="Sending" />);
      expect(screen.getByText('Sending')).toBeTruthy();
    },
  );

  it('is neutral by default', () => {
    render(<Badge label="Draft" />);
    expect(screen.getByText('Draft')).toBeTruthy();
  });
});
