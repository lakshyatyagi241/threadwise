'use client';

/** Only a secure web address or a local preview is drawn as an image: anything else (a `javascript:` or `data:` URL) falls back to the placeholder. */
export const safeImageUrl = (url: string | null | undefined): string | null =>
  typeof url === 'string' && /^(https:\/\/|blob:)/i.test(url) ? url : null;

/** The picture of a group (or a grey disc with a group glyph when there is none). The picture is decorative: the name is next to it. */
export function GroupPicture({
  url,
  size = 40,
}: {
  url: string | null | undefined;
  size?: number;
}) {
  const src = safeImageUrl(url);
  return src ? (
    // A group picture comes from WhatsApp's CDN and changes often: a plain img avoids a build-time image allow list.
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-full bg-muted object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      style={{ width: size, height: size }}
    >
      <svg width={size / 2} height={size / 2} viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13Zm8 0c-.3 0-.6 0-1 .1 1.2.9 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5Z" />
      </svg>
    </span>
  );
}
