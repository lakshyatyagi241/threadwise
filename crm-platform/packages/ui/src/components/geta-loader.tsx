import { cn } from '../cn';

export interface GetaLoaderProps {
  /** Path or address of the brand logo shown at the centre. Left out, only the ring shows. */
  logoSrc?: string;
  /** Pixel size of the logo (the ring is sized from it). Default 30. */
  logoSize?: number;
  /** Fills the viewport and centres the loader, for a whole-page loading state. Default false. */
  fullScreen?: boolean;
  /** Accessible name of the loader; the default is "Loading". */
  label?: string;
  className?: string;
}

/**
 * Geta's branded loader: a slowly turning ring around a gently "breathing" logo. The animations are written inline so the
 * loader works in any app that uses `@crm/ui`, with no keyframes to add to a Tailwind config. They stop for people who ask
 * their system for reduced motion.
 */
export function GetaLoader({
  logoSrc,
  logoSize = 30,
  fullScreen = false,
  label = 'Loading',
  className,
}: GetaLoaderProps) {
  const ringSize = logoSize + 34;

  const loader = (
    <div
      className={cn('relative flex items-center justify-center', className)}
      style={{ width: ringSize, height: ringSize }}
      role="status"
      aria-label={label}
    >
      <div className="geta-loader-ring absolute inset-0 rounded-full border-[3px] border-transparent" />
      {logoSrc && (
        <img
          src={logoSrc}
          alt=""
          width={logoSize}
          height={logoSize}
          className="geta-loader-logo rounded-sm"
        />
      )}
      <style>{`
        .geta-loader-ring {
          border-top-color: var(--primary);
          border-right-color: color-mix(in srgb, var(--primary) 30%, transparent);
          animation: geta-loader-spin 1.4s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }
        .geta-loader-logo {
          animation: geta-loader-breathe 1.8s ease-in-out infinite;
        }
        @keyframes geta-loader-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes geta-loader-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @media (prefers-reduced-motion: reduce) {
          .geta-loader-ring, .geta-loader-logo { animation: none; }
        }
      `}</style>
    </div>
  );

  if (!fullScreen) return loader;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">{loader}</div>
  );
}
