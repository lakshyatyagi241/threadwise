import { render, screen } from '@testing-library/react-native';
import { Banner } from './banner';

describe('Banner', () => {
  it.each(['danger', 'warning', 'info'] as const)(
    'announces its message as an alert (%s)',
    async (tone) => {
      await render(<Banner tone={tone} message="Something to know" />);
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('Something to know')).toBeTruthy();
    },
  );
});
