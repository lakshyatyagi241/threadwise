'use client';

import { useEffect } from 'react';

/** Moves focus to the heading a `#anchor` points at (on load and when the hash changes), so a keyboard or screen-reader user lands on it. */
export function HashFocus() {
  useEffect(() => {
    const focusTarget = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) document.getElementById(id)?.focus();
    };
    focusTarget();
    window.addEventListener('hashchange', focusTarget);
    return () => window.removeEventListener('hashchange', focusTarget);
  }, []);
  return null;
}
