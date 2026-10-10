import { render, screen } from '@testing-library/react-native';
import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('is read out as a progress bar with its value when it has a label', () => {
    render(<ProgressBar percent={62.4} label="Delivered" />);
    const bar = screen.getByRole('progressbar', { name: 'Delivered' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 62 });
  });

  it('stays out of the way of screen readers without a label', () => {
    render(<ProgressBar percent={50} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the fill inside the track', () => {
    render(<ProgressBar percent={180} label="Over" tone="danger" />);
    expect(screen.getByRole('progressbar', { name: 'Over' }).props.accessibilityValue.now).toBe(
      100,
    );
  });
});
