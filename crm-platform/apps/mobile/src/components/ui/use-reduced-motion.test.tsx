import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from './use-reduced-motion';

describe('useReducedMotion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('follows the system setting and its later changes', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    let listener: ((value: boolean) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      _event: string,
      handler: (value: boolean) => void,
    ) => {
      listener = handler;
      return { remove };
    }) as unknown as typeof AccessibilityInfo.addEventListener);

    const { result, unmount } = await renderHook(() => useReducedMotion());
    await act(async () => Promise.resolve());
    expect(result.current).toBe(true);

    await act(() => listener?.(false));
    expect(result.current).toBe(false);

    await unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('assumes motion is fine when the setting cannot be read', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockRejectedValue(new Error('not available'));
    const { result } = await renderHook(() => useReducedMotion());
    await act(async () => Promise.resolve());
    expect(result.current).toBe(false);
  });
});
