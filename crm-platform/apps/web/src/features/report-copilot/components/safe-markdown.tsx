import type { ReactNode } from 'react';
import { parseMarkdown, type Inline } from '../lib/markdown';

function inline(parts: Inline[]): ReactNode[] {
  return parts.map((p, i) => {
    switch (p.t) {
      case 'bold':
        return <strong key={i}>{p.v}</strong>;
      case 'italic':
        return <em key={i}>{p.v}</em>;
      case 'code':
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {p.v}
          </code>
        );
      case 'link':
        return (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline"
          >
            {p.v}
          </a>
        );
      default:
        return p.v;
    }
  });
}

const HEADINGS = { 4: 'h4', 5: 'h5', 6: 'h6' } as const;

/**
 * Model text as markdown, drawn safely: the reader (`lib/markdown.ts`) yields data, this turns it into React elements, so every
 * string is a text node. There is no raw HTML path at all.
 */
export function SafeMarkdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={className ?? 'space-y-2 text-sm leading-relaxed'}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': {
            const H = HEADINGS[b.level];
            return (
              <H key={i} className="pt-1 text-sm font-semibold">
                {inline(b.inline)}
              </H>
            );
          }
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 ps-5">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1 ps-5">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote key={i} className="border-s-2 border-border ps-3 text-muted-foreground">
                {inline(b.inline)}
              </blockquote>
            );
          case 'code':
            return (
              <pre key={i} className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                {b.v}
              </pre>
            );
          default:
            return <p key={i}>{inline(b.inline)}</p>;
        }
      })}
    </div>
  );
}
