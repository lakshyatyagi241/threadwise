/** Wraps the given half-open ranges of `text` in `<mark>`; the ranges come from `searchTiles` and never overlap. */
export function Highlight({
  text,
  ranges,
}: {
  text: string;
  ranges: ReadonlyArray<[number, number]>;
}) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: Array<{ text: string; hit: boolean }> = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push({ text: text.slice(at, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-primary/20 text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
