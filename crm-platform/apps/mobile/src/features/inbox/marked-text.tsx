import type { ReactNode } from 'react';
import type { TextStyle } from 'react-native';
import { Text } from '@/components/ui/text';
import { isEmptyPair, markedRuns, type Run } from './format-text';

/** A mark in the message box: still a character (so every position in the text stays where it is) but too small and clear to be seen. */
const HIDDEN: TextStyle = { color: 'transparent', fontSize: 1 };

/** The look of the words of a run. Bold goes through `fontWeight` (the shared `Text` picks the Inter file from it). */
function wordStyle(run: Run): TextStyle | undefined {
  if (!run.bold && !run.italic && !run.strike) return undefined;
  return {
    ...(run.bold ? { fontWeight: '700' as const } : null),
    ...(run.italic ? { fontStyle: 'italic' as const } : null),
    ...(run.strike ? { textDecorationLine: 'line-through' as const } : null),
  };
}

/**
 * The text of the message box, drawn as WhatsApp will show it: `*bold*`, `_italic_` and `~strike~` look bold, italic and struck through,
 * and the marks themselves are kept but not visible. Nothing is added or removed, so the caret and the selection mean the same thing
 * as in the plain text, and the text that is sent is the text that is stored.
 */
export function composerRuns(text: string, emptyPair: number | null = null): ReactNode[] {
  const draw = (part: string, from: number) =>
    markedRuns(part).map((run, i) => (
      <Text key={`${from}:${i}`} style={run.mark ? HIDDEN : wordStyle(run)}>
        {run.text}
      </Text>
    ));
  // The pair a formatting button just put at the caret holds nothing yet: it is a hidden pair too, so no `**` shows in the box.
  if (emptyPair !== null && isEmptyPair(text.slice(emptyPair, emptyPair + 2))) {
    return [
      ...draw(text.slice(0, emptyPair), 0),
      <Text key="empty" style={HIDDEN}>
        {text.slice(emptyPair, emptyPair + 2)}
      </Text>,
      ...draw(text.slice(emptyPair + 2), emptyPair + 2),
    ];
  }
  return draw(text, 0);
}

/** A sent or received message: the formatting applied and the marks gone, as the customer sees it in WhatsApp. */
export function FormattedText({ text }: { text: string }) {
  return (
    <Text>
      {markedRuns(text).map((run, i) =>
        run.mark ? null : (
          <Text key={i} style={wordStyle(run)}>
            {run.text}
          </Text>
        ),
      )}
    </Text>
  );
}
