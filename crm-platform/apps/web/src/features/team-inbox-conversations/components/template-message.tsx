'use client';

import { useTranslations } from 'next-intl';
import type { MessageTemplate, MessageTemplateButton } from '@crm/contracts';
import {
  CopyIcon,
  FileIcon,
  ImageIcon,
  LinkIcon,
  PhoneIcon,
  PinIcon,
  ReplyIcon,
  VideoIcon,
} from './icons';

const BUTTON_ICON: Record<MessageTemplateButton['type'], typeof ReplyIcon> = {
  quick_reply: ReplyIcon,
  url: LinkIcon,
  phone: PhoneIcon,
  copy_code: CopyIcon,
  other: ReplyIcon,
};

const MEDIA_ICON = {
  image: ImageIcon,
  video: VideoIcon,
  document: FileIcon,
  location: PinIcon,
} as const;

/**
 * A template message as WhatsApp shows it: the header (its text, or a marker for a file the thread does not keep), the body with the
 * values filled in, the footer, and the buttons as rows. A record of what was sent: the buttons do nothing here. Without `preview`
 * (the template was deleted, or the message came in a realtime event) it is the name and the body only.
 */
export function TemplateMessage({
  template,
  text,
}: {
  template: MessageTemplate;
  /** The body the customer read (what was stored at send time, translated when the thread shows a translation). */
  text: string | null;
}) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const preview = template.preview;
  const header = preview?.header ?? null;
  const values = Object.values(template.variables);

  return (
    <div className="space-y-1.5" data-testid="inbox-template-message">
      <p className="text-xs font-medium text-muted-foreground">
        {t('template', { name: template.name })}
      </p>
      {header?.format === 'text' && header.text && (
        <p
          dir="auto"
          className="whitespace-pre-wrap break-words font-semibold"
          data-testid="inbox-template-header"
        >
          {header.text}
        </p>
      )}
      {header && header.format !== 'text' && <MediaMarker format={header.format} />}
      {text ? (
        <p dir="auto" className="whitespace-pre-wrap break-words" data-testid="inbox-template-body">
          {text}
        </p>
      ) : (
        values.length > 0 && <p className="text-xs text-muted-foreground">{values.join(' · ')}</p>
      )}
      {preview?.footer && (
        <p
          dir="auto"
          className="whitespace-pre-wrap break-words text-xs text-muted-foreground"
          data-testid="inbox-template-footer"
        >
          {preview.footer}
        </p>
      )}
      {preview && preview.buttons.length > 0 && (
        <ul
          className="mt-1 space-y-1 border-t border-border pt-1.5"
          data-testid="inbox-template-buttons"
        >
          {preview.buttons.map((b, i) => (
            <TemplateButtonRow key={i} button={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaMarker({ format }: { format: 'image' | 'video' | 'document' | 'location' }) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const Icon = MEDIA_ICON[format];
  return (
    <div
      className="flex h-20 items-center justify-center gap-2 rounded-md border border-border bg-muted text-xs text-muted-foreground"
      data-testid="inbox-template-media"
      data-format={format}
    >
      <Icon width={20} height={20} />
      <span>{t(`templateHeader.${format}`)}</span>
    </div>
  );
}

/** One button, drawn like WhatsApp's: a full-width outlined row with an icon. Not interactive; a screen reader hears "Button: <text>". */
function TemplateButtonRow({ button }: { button: MessageTemplateButton }) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const Icon = BUTTON_ICON[button.type];
  const label =
    button.text.trim() ||
    (button.type === 'copy_code' ? t('templateCopyCode') : t('templateButtonUnnamed'));
  return (
    <li
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-primary"
      data-button-type={button.type}
    >
      <Icon width={14} height={14} />
      <span className="sr-only">{t('templateButtonPrefix')}</span>
      <span dir="auto" className="min-w-0 truncate">
        {label}
      </span>
    </li>
  );
}
