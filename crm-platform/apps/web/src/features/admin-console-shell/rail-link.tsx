'use client';

import Link from 'next/link';
import { cn } from '@crm/ui';
import { ConsoleIcon } from './console-icons';

/** Labels vanish only on desktop and only when the rail is collapsed; the phone drawer is always full. */
export const HIDE_WHEN_COLLAPSED = 'md:group-data-[collapsed=true]/rail:hidden';

/**
 * A link that stands on its own in the rail (Home, an area, Your account): an icon and a name, and only the icon when the rail
 * is collapsed. While two-factor enrolment is pending it is drawn disabled, since the API refuses every other page.
 */
export function RailLink({
  href,
  icon,
  label,
  active,
  disabled,
  testId,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const body = (
    <>
      <ConsoleIcon name={icon} />
      <span className={cn('min-w-0 flex-1 truncate', HIDE_WHEN_COLLAPSED)}>{label}</span>
    </>
  );
  const cls = cn(
    'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium',
    'md:group-data-[collapsed=true]/rail:justify-center',
  );
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(cls, 'opacity-40')}>
        {body}
      </span>
    );
  }
  return (
    <Link
      href={href}
      title={label}
      data-testid={testId}
      aria-current={active ? 'page' : undefined}
      className={cn(
        cls,
        'hover:bg-sidebar-active focus-visible:ring-2 focus-visible:ring-primary',
        active && 'bg-sidebar-active text-white',
      )}
    >
      {body}
    </Link>
  );
}
