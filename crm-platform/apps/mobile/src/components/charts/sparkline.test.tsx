import { render, screen } from '@testing-library/react-native';
import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  it('is one image with a sentence for screen readers, whatever the bars', () => {
    render(<Sparkline values={[0, 4, 8, 2]} label="Messages per hour" />);
    expect(screen.getByRole('image', { name: 'Messages per hour' })).toBeTruthy();
  });

  it('draws an empty series without crashing', () => {
    render(<Sparkline values={[]} label="Nothing yet" />);
    expect(screen.getByRole('image', { name: 'Nothing yet' })).toBeTruthy();
  });
});
