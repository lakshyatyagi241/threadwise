import type { ReactNode } from 'react';
import { ACTIVITY_ICONS } from '@crm/contracts';

const PATHS: Record<(typeof ACTIVITY_ICONS)[number], ReactNode> = {
  task: <path d="M5 12l4 4 10-10M4 4h16v16H4z" />,
  meeting: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />,
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  reminder: (
    <>
      <path d="M12 3a6 6 0 00-6 6v4l-2 3h16l-2-3V9a6 6 0 00-6-6z" />
      <path d="M10 20a2 2 0 004 0" />
    </>
  ),
  sms: <path d="M4 5h16v11H9l-5 4V5z" />,
  chat: (
    <>
      <path d="M4 5h12v9H8l-4 3V5z" />
      <path d="M18 9h2v9l-3-2h-6" />
    </>
  ),
  visit: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10l6-3v10l-6-3" />
    </>
  ),
  document: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  flag: <path d="M6 21V4h11l-2 4 2 4H6" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
};

/** One of the drawn activity icons (an unknown name gets the task tick). */
export function ActivityIcon({ name, className }: { name: string; className?: string }) {
  const body = PATHS[name as keyof typeof PATHS] ?? PATHS.task;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'size-5'}
    >
      {body}
    </svg>
  );
}
