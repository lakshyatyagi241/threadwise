/**
 * Draws Geta's loader on a canvas: three arcs with a soft glow turning around the centre, each at its own speed and direction.
 * The numbers are those of the design, laid out on a 320 by 320 square; `size` scales it to any pixel size. Returns a function that
 * stops the animation. For people who ask their system for reduced motion one still frame is drawn.
 */
const BASE = 320;

const ARCS = [
  { r: 148, speed: 0.022, gap: 0.55, color: '#1640F5', lw: 3.5, phase: 0 },
  { r: 124, speed: -0.034, gap: 1.3, color: '#4d6ff8', lw: 2.8, phase: 1.2 },
  { r: 102, speed: 0.05, gap: 0.9, color: '#1640F5', lw: 2.2, phase: 2.6 },
] as const;

export function startGetaLoaderAnimation(canvas: HTMLCanvasElement, size: number): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const scale = (size * dpr) / BASE;
  const c = BASE / 2;
  const phases: number[] = ARCS.map((a) => a.phase);

  const frame = (step: number) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, BASE, BASE);
    ARCS.forEach((a, i) => {
      phases[i] = (phases[i] ?? 0) + a.speed * step;
      const from = phases[i] ?? 0;
      const to = from + (Math.PI * 2 - a.gap);
      ctx.lineCap = 'round';
      ctx.strokeStyle = a.color;
      // The glow trail, then the sharp arc.
      ctx.beginPath();
      ctx.arc(c, c, a.r, from, to);
      ctx.lineWidth = a.lw + 6;
      ctx.globalAlpha = 0.12;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c, a.r, from, to);
      ctx.lineWidth = a.lw;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  };

  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    frame(0);
    return () => undefined;
  }

  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    // The design's speeds are per frame at 60 frames a second: scale by the time that passed, so a fast screen does not spin faster.
    const step = last === 0 ? 1 : Math.min((now - last) / (1000 / 60), 4);
    last = now;
    frame(step);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
