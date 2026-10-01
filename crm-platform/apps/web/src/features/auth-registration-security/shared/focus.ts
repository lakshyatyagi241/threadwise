/**
 * Moves focus to the first control marked invalid. Call it right after setting
 * the error state: it waits a frame so the `aria-invalid` attributes exist.
 */
export function focusFirstInvalid(root: HTMLElement | null): void {
  if (!root) return;
  requestAnimationFrame(() => {
    root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}
