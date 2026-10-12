import { fireEvent, screen } from '@testing-library/react-native';

type TestInstance = ReturnType<typeof screen.getByTestId>;

const WIDTH = 320;
const VIEW_HEIGHT = 600;
const CONTENT_HEIGHT = 1000;

/**
 * Scrolls a list to its end, the way a thumb would: the list first learns how big it and its content are, then is scrolled to the
 * bottom, which is what makes it ask for the next page. (A scroll alone is ignored: the list does not know its size under test.)
 */
export async function reachEnd(list: TestInstance) {
  await fireEvent(list, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: VIEW_HEIGHT } },
  });
  await fireEvent(list, 'contentSizeChange', WIDTH, CONTENT_HEIGHT);
  await fireEvent.scroll(list, {
    nativeEvent: {
      contentOffset: { x: 0, y: CONTENT_HEIGHT - VIEW_HEIGHT },
      contentSize: { width: WIDTH, height: CONTENT_HEIGHT },
      layoutMeasurement: { width: WIDTH, height: VIEW_HEIGHT },
    },
  });
}
