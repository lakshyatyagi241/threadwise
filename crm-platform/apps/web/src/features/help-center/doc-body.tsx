import Link from 'next/link';
import type { ReactNode } from 'react';
import { degradeDocLinks } from './blocks';
import type { HelpBlock, HelpInline } from './types';

const LINK = 'text-primary underline-offset-2 hover:underline focus-visible:underline';

function Runs({ inline }: { inline: readonly HelpInline[] }): ReactNode {
  return inline.map((run, i) => {
    switch (run.t) {
      case 'bold':
        return <strong key={i}>{run.v}</strong>;
      case 'code':
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {run.v}
          </code>
        );
      case 'link':
        return (
          <Link key={i} href={run.href} className={LINK}>
            {run.v}
          </Link>
        );
      case 'doc':
        return (
          <Link key={i} href={`/help/${run.doc}`} className={LINK}>
            {run.v}
          </Link>
        );
      default:
        return run.v;
    }
  });
}

/**
 * A doc's body. The compiler already restricted what a doc can contain, and React escapes every string, so nothing here can run
 * markup. A link to a doc the person cannot see is shown as plain text (see `degradeDocLinks`).
 */
export function DocBody({
  blocks,
  visibleIds,
}: {
  blocks: readonly HelpBlock[];
  visibleIds: ReadonlySet<string>;
}) {
  return (
    <div className="space-y-4 text-sm leading-7 text-foreground">
      {degradeDocLinks(blocks, visibleIds).map((block, i) => {
        switch (block.t) {
          case 'h':
            return block.level === 2 ? (
              <h2
                key={i}
                id={block.id}
                tabIndex={-1}
                className="scroll-mt-20 pt-4 text-xl font-semibold tracking-tight outline-none"
              >
                {block.text}
              </h2>
            ) : (
              <h3
                key={i}
                id={block.id}
                tabIndex={-1}
                className="scroll-mt-20 pt-2 text-base font-semibold outline-none"
              >
                {block.text}
              </h3>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 ps-6">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Runs inline={item} />
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1 ps-6">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Runs inline={item} />
                  </li>
                ))}
              </ol>
            );
          case 'note':
            return (
              <div
                key={i}
                role="note"
                className="rounded-md border border-border bg-muted px-4 py-3"
              >
                <Runs inline={block.inline} />
              </div>
            );
          default:
            return (
              <p key={i}>
                <Runs inline={block.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
