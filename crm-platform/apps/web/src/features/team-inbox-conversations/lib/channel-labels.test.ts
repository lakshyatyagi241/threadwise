import { describe, expect, it } from 'vitest';
import { channelPickerLabels } from './channel-labels';

describe('channelPickerLabels', () => {
  it('keeps a unique name as it is', () => {
    const labels = channelPickerLabels([
      { id: 'a', name: 'Simulator' },
      { id: 'b', name: 'Web bot' },
    ]);
    expect(labels.get('a')).toBe('Simulator');
    expect(labels.get('b')).toBe('Web bot');
  });

  it('numbers repeated names in list order so each choice can be told apart', () => {
    const labels = channelPickerLabels([
      { id: 'a', name: 'New flow' },
      { id: 'b', name: 'Web bot' },
      { id: 'c', name: 'New flow' },
      { id: 'd', name: 'New flow' },
    ]);
    expect(labels.get('a')).toBe('New flow (1)');
    expect(labels.get('c')).toBe('New flow (2)');
    expect(labels.get('d')).toBe('New flow (3)');
    expect(labels.get('b')).toBe('Web bot');
  });

  it('gives every channel a label, including an empty list', () => {
    expect(channelPickerLabels([]).size).toBe(0);
  });
});
