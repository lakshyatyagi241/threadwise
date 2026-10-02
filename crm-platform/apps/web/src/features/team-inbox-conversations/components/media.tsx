'use client';

import { useTranslations } from 'next-intl';
import type { MessageLocation, MessageMedia } from '@crm/contracts';
import { humanSize } from '../lib/time';
import { ExternalIcon, FileIcon, PinIcon } from './icons';

/**
 * Media comes from the API as a short-lived authenticated url (`/api/v2/media/<token>`), so it is shown with the session cookie
 * and never stored. Nothing here loads from another site: a location is a card with a link, not an embedded map.
 */

export function ImageMedia({ media, alt }: { media: MessageMedia; alt: string }) {
  const t = useTranslations('team-inbox-conversations.media');
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('openImage', { name: alt })}
      className="block overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Streamed through the authenticated proxy, so the framework image optimiser (a public fetch) cannot be used. */}
      <img
        src={media.url}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="max-h-72 w-full max-w-xs rounded-md bg-muted object-cover"
      />
    </a>
  );
}

export function StickerMedia({ media, alt }: { media: MessageMedia; alt: string }) {
  return <img src={media.url} alt={alt} loading="lazy" className="size-28 object-contain" />;
}

export function VideoMedia({ media }: { media: MessageMedia }) {
  const t = useTranslations('team-inbox-conversations.media');
  return (
    <video
      controls
      preload="none"
      aria-label={media.name ?? t('video')}
      className="max-h-72 w-full max-w-xs rounded-md bg-black"
    >
      <source src={media.url} type={media.mime} />
    </video>
  );
}

export function AudioMedia({ media, voice }: { media: MessageMedia; voice: boolean }) {
  const t = useTranslations('team-inbox-conversations.media');
  return (
    <audio
      controls
      preload="none"
      aria-label={voice ? t('voice') : (media.name ?? t('audio'))}
      className="h-10 w-64 max-w-full"
    >
      <source src={media.url} type={media.mime} />
    </audio>
  );
}

export function DocumentMedia({ media }: { media: MessageMedia }) {
  const t = useTranslations('team-inbox-conversations.media');
  const name = media.name ?? t('document');
  return (
    <a
      href={media.url}
      download={media.name ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('download', { name })}
      className="flex w-64 max-w-full items-center gap-3 rounded-md border border-border bg-background/70 p-2.5 hover:bg-background focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FileIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block text-xs text-muted-foreground">
          {media.sizeBytes != null ? humanSize(media.sizeBytes) : media.mime}
        </span>
      </span>
      <ExternalIcon width={14} height={14} className="shrink-0 text-muted-foreground" />
    </a>
  );
}

/** Coordinates are formatted with a fixed number of digits; the link opens the point on OpenStreetMap in a new tab. */
export function LocationCard({ location }: { location: MessageLocation }) {
  const t = useTranslations('team-inbox-conversations.media');
  const lat = location.latitude;
  const lon = location.longitude;
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-64 max-w-full items-start gap-3 rounded-md border border-border bg-background/70 p-2.5 hover:bg-background focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-danger/10 text-danger">
        <PinIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{location.name ?? t('location')}</span>
        {location.address && (
          <span className="block truncate text-xs text-muted-foreground">{location.address}</span>
        )}
        <span className="block text-xs text-muted-foreground">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </span>
        <span className="mt-0.5 block text-xs text-primary">{t('openMap')}</span>
      </span>
    </a>
  );
}
