import { cn } from '@crm/ui';
import { NavIcon } from '@/components/shell/nav-icons';
import type { NotificationIcon, NotificationTone } from '../lib/catalogue';

/** The shell icon that stands for each kind of notification (the shell's own drawn set, so no second icon library). */
export const ICON_ART: Readonly<Record<NotificationIcon, string>> = {
  chat: 'chat',
  waiting: 'clock',
  assign: 'inbox',
  mention: 'reply',
  team_chat: 'team',
  group: 'groups',
  device_on: 'phone',
  device_off: 'phone',
  broadcast: 'broadcast',
  campaign: 'campaign',
  schedule: 'clock',
  task: 'tasks',
  lead: 'contacts',
  form: 'forms',
  document: 'proposal',
  wallet: 'payment',
  generic: 'bell',
};

const TONE: Record<NotificationTone, string> = {
  info: 'bg-brand/10 text-brand',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
};

/**
 * A small round icon for a notification row or toast. It is decoration (`aria-hidden`): the row's words carry the meaning, and the
 * tone is also in `data-tone` so a test can see it without reading colours.
 */
export function TypeIcon({
  icon,
  tone,
  className,
}: {
  icon: NotificationIcon;
  tone: NotificationTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-icon={icon}
      data-tone={tone}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full',
        TONE[tone],
        className,
      )}
    >
      <NavIcon name={ICON_ART[icon]} className="size-4" />
    </span>
  );
}
