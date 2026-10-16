import type { ReactNode } from 'react';
import { cn } from '@crm/ui';

/**
 * The rows WhatsApp draws under a bubble: full width to its edges, a hairline above each row, the label in WhatsApp's link blue.
 * A row with a `href` is a link (a web page opens in a new tab, a `tel:` link dials); without one it is drawn but does nothing.
 */
export function BubbleButtonList({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <ul data-testid={testId} className={cn('-mx-3 mt-2 flex list-none flex-col', className)}>
      {children}
    </ul>
  );
}

export function BubbleButton({
  href,
  icon,
  label,
  dataType,
  testId,
  linkTestId,
  tone = 'link',
  children,
}: {
  href: string | null;
  icon?: ReactNode;
  label?: string;
  dataType?: string;
  testId?: string;
  linkTestId?: string;
  /** `plain` is for a row that is only information (a number on a contact card): the blue is for actions. */
  tone?: 'link' | 'plain';
  children?: ReactNode;
}) {
  const row = cn(
    'flex w-full items-center justify-center gap-2 border-t border-black/10 px-3 py-2.5 text-center text-sm font-medium dark:border-white/10',
    tone === 'link' ? 'text-[#027eb5] dark:text-[#53bdeb]' : 'text-foreground',
  );
  const content = (
    <>
      {icon}
      <span dir="auto" className="min-w-0 truncate">
        {label}
      </span>
      {children}
    </>
  );
  return (
    <li data-button-type={dataType} data-testid={testId} className="list-none">
      {href ? (
        <a
          href={href}
          target={href.startsWith('tel:') ? undefined : '_blank'}
          rel={href.startsWith('tel:') ? undefined : 'noopener noreferrer'}
          data-testid={linkTestId}
          className={cn(
            row,
            'hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          )}
        >
          {content}
        </a>
      ) : (
        <span className={row}>{content}</span>
      )}
    </li>
  );
}
