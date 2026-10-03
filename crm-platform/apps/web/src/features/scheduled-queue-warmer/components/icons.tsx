import { cn } from '@crm/ui';

const PATHS = {
  back: 'M10 4l-4 4 4 4',
  plus: 'M8 3v10M3 8h10',
  search: 'M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2zM11 11l3 3',
  open: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  pause: 'M5.5 3v10M10.5 3v10',
  resume: 'M5 3l8 5-8 5z',
  runNow: 'M3 8h9M8.5 4.5L12 8l-3.5 3.5',
  cancel: 'M4 4l8 8M12 4l-8 8',
  delete: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.5 8.5h6l.5-8.5',
  retry: 'M3 8a5 5 0 0 1 8.5-3.5L13 6M13 8a5 5 0 0 1-8.5 3.5L3 10M13 3v3h-3M3 13v-3h3',
  next: 'M6 3l5 5-5 5',
  check: 'M3.5 8.5l3 3 6-7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-3.5 shrink-0', className)}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
