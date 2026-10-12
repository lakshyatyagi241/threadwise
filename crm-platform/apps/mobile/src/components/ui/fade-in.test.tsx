import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { FadeIn } from './fade-in';
import { Text } from './text';

/** Records every entrance FadeIn starts, so a test can see whether it is still running. */
function recordAnimations() {
  const started: { config: Animated.TimingAnimationConfig; stop: jest.Mock }[] = [];
  jest.spyOn(Animated, 'timing').mockImplementation((_value, config) => {
    const stop = jest.fn();
    started.push({ config, stop });
    return { start: jest.fn(), stop, reset: jest.fn() };
  });
  return started;
}

describe('FadeIn', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders its content and plays the entrance after the given delay', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const started = recordAnimations();
    await render(
      <FadeIn delay={120}>
        <Text>Arriving</Text>
      </FadeIn>,
    );
    await act(async () => Promise.resolve());
    expect(screen.getByText('Arriving')).toBeTruthy();
    expect(started).toHaveLength(1);
    expect(started[0]?.config).toMatchObject({ toValue: 1, delay: 120, useNativeDriver: true });
    expect(started[0]?.stop).not.toHaveBeenCalled();
  });

  it('drops the entrance when the person asked for less motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const started = recordAnimations();
    await render(
      <FadeIn>
        <Text>Still</Text>
      </FadeIn>,
    );
    await act(async () => Promise.resolve());
    expect(screen.getByText('Still')).toBeTruthy();
    // Nothing is left moving: any entrance begun before the setting was read has been stopped.
    expect(started.every((animation) => animation.stop.mock.calls.length > 0)).toBe(true);
  });
});
