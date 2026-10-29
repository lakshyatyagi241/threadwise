/**
 * Small flat portraits used in place of initials. They are drawn, not photographs, so they never pass for a real person's
 * face next to a real name or a sample contact. Each look varies the hair, skin tone and shirt.
 */
export type PortraitLook = 'crop' | 'sweep' | 'curl' | 'bun';

interface Palette {
  bg: string;
  skin: string;
  hair: string;
  shirt: string;
}

const PALETTES: Record<PortraitLook, Palette> = {
  crop: { bg: '#dbe4f3', skin: '#c68a62', hair: '#1f2433', shirt: '#2f3a8f' },
  sweep: { bg: '#e4e7ef', skin: '#e0ac84', hair: '#3b2a22', shirt: '#475569' },
  curl: { bg: '#dfe9ec', skin: '#8f5a3c', hair: '#14161f', shirt: '#0f766e' },
  bun: { bg: '#e8e3ef', skin: '#d39a74', hair: '#2a1d1a', shirt: '#4f46a5' },
};

const HAIR: Record<PortraitLook, string> = {
  crop: 'M20.6 27.5c-.9-9.2 4.7-14.6 11.4-14.6s12.3 5.4 11.4 14.6c-1.6-4.9-5.8-8.1-11.4-8.1s-9.8 3.2-11.4 8.1z',
  sweep:
    'M20.3 28.5c-1.3-10.3 4.6-15.6 12.1-15.6 7.3 0 11.7 5.2 11.2 13.8-3.2-1.1-6-4-8-7.4-3 4.1-8.6 7.1-15.3 9.2z',
  curl: 'M20.4 28c-2-4.2-.5-9.4 2.7-11.4.8-4.2 6.3-6.2 9-4 3.2-2.3 8.3-.1 9 4.1 3.3 2 4.8 7.2 2.6 11.5-1.7-4.6-5.5-7.4-11.6-7.4S22.1 23.4 20.4 28z',
  bun: 'M20.6 28c-.8-9 4.6-14.2 11.4-14.2S43.2 19 43.4 28c-1.6-5-5.6-8-11.4-8s-9.8 3-11.4 8z',
};

export function Portrait({ look, className }: { look: PortraitLook; className?: string }) {
  const p = PALETTES[look];
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <circle cx="32" cy="32" r="32" fill={p.bg} />
      <path d="M7 64c1.5-13 11-19.5 25-19.5S55.5 51 57 64z" fill={p.shirt} />
      <path d="M26.5 40h11v7.5c-2 2-9 2-11 0z" fill={p.skin} opacity=".92" />
      <ellipse cx="32" cy="29" rx="11" ry="12.4" fill={p.skin} />
      {look === 'bun' && <circle cx="32" cy="12.6" r="5.4" fill={p.hair} />}
      <path d={HAIR[look]} fill={p.hair} />
      <circle cx="27.6" cy="30" r="1.05" fill={p.hair} opacity=".55" />
      <circle cx="36.4" cy="30" r="1.05" fill={p.hair} opacity=".55" />
      <path
        d="M29.2 35.6c1.8 1.5 3.8 1.5 5.6 0"
        fill="none"
        stroke={p.hair}
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity=".5"
      />
    </svg>
  );
}
