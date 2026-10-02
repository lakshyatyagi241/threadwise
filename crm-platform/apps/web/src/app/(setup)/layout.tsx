import type { ReactNode } from 'react';

/**
 * First-run setup: no session exists yet, so this group has no guard and no shell, just Reference's installer backdrop (a
 * dot grid with two soft glows) around one centred card. The page never scrolls; only a tall step scrolls inside the card.
 */
export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <main
      className="relative grid h-dvh w-full place-items-center overflow-hidden bg-muted p-4 sm:p-6 lg:p-8"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--brand) 9%, transparent) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <style>{`
        @keyframes wiz-card-in { from { opacity: 0; transform: translateY(10px) scale(.99); } to { opacity: 1; transform: none; } }
        @keyframes wiz-step-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>
      <div className="pointer-events-none absolute -left-24 -top-32 size-[28rem] rounded-full bg-primary/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 size-[28rem] rounded-full bg-brand/20 blur-[120px]" />
      {children}
    </main>
  );
}
