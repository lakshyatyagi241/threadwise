/**
 * Trims the characters `isEdge` accepts from both ends, in one pass over the string.
 *
 * Not `value.replace(/^[...]+|[...]+$/g, '')`: the `[...]+$` half is tried from every position of a long run of edge characters that is
 * NOT at the end ("          ...x"), which is quadratic, and a message of 300 000 spaces then ends a worker for minutes. Characters are
 * judged by code point, so an astral character (a tag character, a surrogate pair) is one unit as it is in a `u` regex.
 */
export function trimEdges(value: string, isEdge: (char: string) => boolean): string {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const char = String.fromCodePoint(value.codePointAt(start)!);
    if (!isEdge(char)) break;
    start += char.length;
  }
  while (end > start) {
    let from = end - 1;
    const low = value.charCodeAt(from);
    if (low >= 0xdc00 && low <= 0xdfff && from > start) {
      const high = value.charCodeAt(from - 1);
      if (high >= 0xd800 && high <= 0xdbff) from -= 1;
    }
    if (!isEdge(value.slice(from, end))) break;
    end = from;
  }
  return value.slice(start, end);
}
