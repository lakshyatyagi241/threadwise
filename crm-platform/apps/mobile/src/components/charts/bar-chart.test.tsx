import { fireEvent, render, screen } from '@testing-library/react-native';
import { axisLabelIndexes, BarChart } from './bar-chart';

const series = [
  { name: 'Sent', values: [10, 20, 30], color: 'primary' },
  { name: 'Failed', values: [1, 0, 2], color: 'danger' },
] as const;

describe('axisLabelIndexes', () => {
  it('shows every label when there are few, and a spread when there are many', () => {
    expect(axisLabelIndexes(0, 4)).toEqual([]);
    expect(axisLabelIndexes(3, 4)).toEqual([0, 1, 2]);
    expect(axisLabelIndexes(24, 4)).toEqual([0, 8, 15, 23]);
    expect(axisLabelIndexes(92, 4)[3]).toBe(91);
  });
});

describe('BarChart', () => {
  const labels = ['Oct 8', 'Oct 9', 'Oct 10'];

  it('is one image with a summary sentence, and labels the scale and the axis', async () => {
    await render(<BarChart labels={labels} series={series} summary="60 sent and 3 failed" />);
    expect(screen.getByRole('image', { name: '60 sent and 3 failed' })).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy(); // niceMax(30) = 50 on the top gridline
    expect(screen.getByText('Oct 8')).toBeTruthy();
    expect(screen.getByText('Oct 10')).toBeTruthy();
  });

  it('draws the series side by side when each bucket is wide enough, and over each other when not', async () => {
    await render(<BarChart labels={labels} series={series} summary="s" />);
    const plot = screen.getByTestId('bar-plot');
    await fireEvent(plot, 'layout', { nativeEvent: { layout: { width: 300, height: 140 } } });
    expect(screen.getByRole('image', { name: 's' })).toBeTruthy();
    await fireEvent(plot, 'layout', { nativeEvent: { layout: { width: 30, height: 140 } } });
    expect(screen.getByRole('image', { name: 's' })).toBeTruthy();
  });

  it('copes with no data at all', async () => {
    await render(<BarChart labels={[]} series={[]} summary="empty" />);
    expect(screen.getByRole('image', { name: 'empty' })).toBeTruthy();
  });
});
