/**
 * The text of one `<option>` in a native select. The popup of a select is as wide as its longest option, so one record with a very
 * long name (a group named after a pasted list, say) stretches the menu across the whole screen. Names past `max` characters are
 * cut with an ellipsis; the full name stays available as the option's `title`.
 */
export function optionLabel(name: string, max = 48): string {
  const text = name.replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}
