import { render, screen } from '@testing-library/react-native';
import { OrDivider } from './or-divider';

describe('OrDivider', () => {
  it('shows its word between two lines', async () => {
    await render(<OrDivider label="OR" />);
    expect(screen.getByText('OR')).toBeTruthy();
    expect(screen.getByTestId('or-divider').children).toHaveLength(3);
  });
});
