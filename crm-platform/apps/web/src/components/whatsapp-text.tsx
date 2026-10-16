import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import { parseWhatsApp, type Block, type Inline } from '@/lib/whatsapp-format';

function renderRuns(runs: Inline[], keyBase: string): ReactNode[] {
  return runs.map((r, i) => {
    const key = `${keyBase}.${i}`;
    switch (r.kind) {
      case 'text':
        return <span key={key}>{r.text}</span>;
      case 'var':
        return (
          <span key={key} className="rounded bg-success/15 px-1 font-medium text-success">
            {`{{${r.token}}}`}
          </span>
        );
      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-foreground/10 px-1 font-mono text-[0.9em] whitespace-pre-wrap"
          >
            {r.text}
          </code>
        );
      case 'bold':
        return <strong key={key}>{renderRuns(r.children, key)}</strong>;
      case 'italic':
        return <em key={key}>{renderRuns(r.children, key)}</em>;
      case 'strike':
        return <del key={key}>{renderRuns(r.children, key)}</del>;
    }
  });
}

/** A line with nothing on it keeps its height, the way WhatsApp keeps a blank line. */
function line(runs: Inline[], key: string): ReactNode {
  return <div key={key}>{runs.length > 0 ? renderRuns(runs, key) : <br />}</div>;
}

function renderBlock(b: Block, i: number): ReactNode {
  const key = `b${i}`;
  switch (b.kind) {
    case 'line':
      return line(b.runs, key);
    case 'quote':
      return (
        <blockquote
          key={key}
          className="border-s-2 border-muted-foreground/50 ps-2 text-muted-foreground"
        >
          {b.items.map((it, j) => line(it, `${key}.${j}`))}
        </blockquote>
      );
    case 'ul':
      return (
        <ul key={key} className="list-disc ps-5">
          {b.items.map((it, j) => (
            <li key={`${key}.${j}`}>{renderRuns(it, `${key}.${j}`)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className="list-decimal ps-5">
          {b.items.map((it, j) => (
            <li key={`${key}.${j}`}>{renderRuns(it, `${key}.${j}`)}</li>
          ))}
        </ol>
      );
  }
}

/**
 * A text in WhatsApp's markup, drawn with its bold, italic, strike, monospace, quote, list and number formatting. Elements only,
 * so a message can never inject HTML. Renders a `div` (not a `p`) so it can sit in any bubble.
 */
export function WhatsAppText({
  text,
  variables = false,
  className,
}: {
  text: string;
  /** Draw `{{name}}` as a template variable pill. */
  variables?: boolean;
  className?: string;
}) {
  const blocks = parseWhatsApp(text, { variables });
  return (
    <div dir="auto" className={cn('break-words', className)}>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
}
