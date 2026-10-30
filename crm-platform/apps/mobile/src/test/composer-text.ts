import { StyleSheet, type TextStyle } from 'react-native';

/**
 * The message box draws its words as styled pieces (children of the input; React Native refuses a `value` next to them), so a test reads
 * its text from the children: the pieces joined, marks included.
 */
export const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return '';
};

type Piece = { props: { style?: unknown; children?: unknown } };
const styleOf = (node: Piece): TextStyle => StyleSheet.flatten(node.props.style as TextStyle) ?? {};

/** What can be seen in the box: the pieces whose colour is not clear (the marks are drawn clear). */
export const seenOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(seenOf).join('');
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && 'props' in node) {
    const piece = node as Piece;
    return styleOf(piece).color === 'transparent' ? '' : seenOf(piece.props.children);
  }
  return '';
};

/** The pieces of the box drawn bold (read from the pieces as written: the shared Text turns the weight into the Inter Bold file only when drawn). */
export const boldOf = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap((n) => boldOf(n));
  if (node && typeof node === 'object' && 'props' in node) {
    const piece = node as Piece;
    const own = styleOf(piece).fontWeight === '700' ? [textOf(piece.props.children)] : [];
    return [...own, ...boldOf(piece.props.children)];
  }
  return [];
};
