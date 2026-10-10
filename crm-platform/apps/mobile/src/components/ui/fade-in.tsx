import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from './use-reduced-motion';

interface Props {
  children: ReactNode;
  /** Milliseconds to wait before starting, to let a group of cards arrive one after another. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

const DURATION = 340;
const RISE = 16;

/**
 * Brings its content in with a short fade and a small rise, once, when it first appears. Runs on the UI thread (native driver),
 * and shows the content straight away when the person asked for less motion. Give it a `key` to play again for new content.
 */
export function FadeIn({ children, delay = 0, style }: Props) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] }) },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
