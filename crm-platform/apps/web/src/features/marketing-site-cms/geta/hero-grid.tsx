'use client';

import { useEffect } from 'react';

const CELL = 48;
const FADE_MS = 2200;
const PEAK = 0.09;
const REDUCED = '(prefers-reduced-motion: reduce)';
const INDIGO = '50, 20, 219';
const GREEN = '0, 160, 96';

/**
 * Makes the squares of the hero's grid react to the pointer: the square under the cursor lights up, its neighbours a little less,
 * and each fades out after the cursor leaves. It draws on a canvas laid behind the hero's content, so nothing in the hero moves.
 * The grid lines are centred on the hero (see the hero background in home.css), so the squares are counted from the centre.
 */
export function HeroGrid() {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>('header.gx-hero');
    if (!hero) return;
    const reduced = window.matchMedia(REDUCED).matches;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'hero-cells';
    hero.prepend(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cells = new Map<string, { c: number; r: number; a: number }>();
    let raf = 0;
    let last = 0;
    let w = 0;
    let h = 0;

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      w = hero.clientWidth;
      h = hero.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      const dt = last ? now - last : 16;
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (const [key, cell] of cells) {
        cell.a -= dt / FADE_MS;
        if (cell.a <= 0) {
          cells.delete(key);
          continue;
        }
        const x = w / 2 + cell.c * CELL + 1;
        const y = cell.r * CELL + 1;
        const tone = (cell.c + cell.r) % 2 === 0 ? INDIGO : GREEN;
        ctx.fillStyle = `rgba(${tone}, ${(cell.a * PEAK).toFixed(3)})`;
        ctx.fillRect(x, y, CELL - 1, CELL - 1);
      }
      if (cells.size) raf = requestAnimationFrame(draw);
      else {
        raf = 0;
        last = 0;
      }
    };

    const light = (c: number, r: number, a: number) => {
      const key = `${c},${r}`;
      const cell = cells.get(key);
      if (cell) cell.a = Math.max(cell.a, a);
      else cells.set(key, { c, r, a });
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const rect = hero.getBoundingClientRect();
      const c = Math.floor((e.clientX - rect.left - rect.width / 2) / CELL);
      const r = Math.floor((e.clientY - rect.top) / CELL);
      if (reduced) cells.clear();
      light(c, r, 1);
      if (!reduced) {
        for (let dc = -1; dc <= 1; dc++) {
          for (let dr = -1; dr <= 1; dr++) if (dc || dr) light(c + dc, r + dr, 0.3);
        }
      }
      if (!raf) raf = requestAnimationFrame(draw);
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(hero);
    hero.addEventListener('pointermove', onMove);
    return () => {
      hero.removeEventListener('pointermove', onMove);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      canvas.remove();
    };
  }, []);
  return null;
}
