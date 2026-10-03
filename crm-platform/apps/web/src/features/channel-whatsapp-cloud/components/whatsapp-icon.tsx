import type { SVGProps } from 'react';

/**
 * The WhatsApp mark as a simple drawn glyph (a speech bubble with a handset), in the colour of the surrounding text. Drawn here
 * rather than copied from any vendor asset; it only has to be recognisable at badge size.
 */
export function WhatsappGlyph({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      <path d="M3.5 20.5l1.3-4.2A8.6 8.6 0 1 1 8 19.3l-4.5 1.2z" />
      <path
        d="M9.2 8.1c.2-.4.5-.4.8-.4h.4c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.1.1-.1.3 0 .4.6 1 1.4 1.8 2.5 2.4.2.1.3.1.4 0l.7-.8c.1-.2.3-.2.5-.1l1.5.7c.2.1.3.3.3.5 0 .9-.8 1.6-1.7 1.7-1.2.1-2.9-.6-4.4-2-1.4-1.3-2.2-2.9-2.2-3.8 0-.7.3-1.3.8-1.8z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
