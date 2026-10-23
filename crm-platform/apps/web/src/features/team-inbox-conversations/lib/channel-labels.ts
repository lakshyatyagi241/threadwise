/**
 * The name a channel shows in a picker. Two channels can share a name (several website-chat flows are all called "New flow"), so a
 * repeated name is numbered in the order the list has them: "New flow (1)", "New flow (2)". Names that are unique stay as they are.
 */
export function channelPickerLabels(
  channels: ReadonlyArray<{ id: string; name: string }>,
): Map<string, string> {
  const count = new Map<string, number>();
  for (const c of channels) count.set(c.name, (count.get(c.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const c of channels) {
    if ((count.get(c.name) ?? 0) < 2) {
      labels.set(c.id, c.name);
      continue;
    }
    const n = (seen.get(c.name) ?? 0) + 1;
    seen.set(c.name, n);
    labels.set(c.id, `${c.name} (${n})`);
  }
  return labels;
}
